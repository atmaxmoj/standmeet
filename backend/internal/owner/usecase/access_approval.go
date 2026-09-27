// access_approval.go — approve a gate access request: issue an AccessCode, and have it
// **delivered** to the requester.
//
// Issuing the code is core business and happens here, synchronously: the owner gets the code and
// link at once. Delivery is a durable job (entity.ApprovalNoticeKind) enqueued in the same
// transaction as the code, so a committed code always has its mail on the way. The job sends,
// then marks the request replied — a request never reads "replied" for a mail that did not go.
// This package holds no send port; it only asks whether delivery is possible at all.

package usecase

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"fmt"
	"strings"
	"time"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

const (
	inviteCodePrefix   = "inv"
	inviteCodeRandSize = 4
	inviteCodeRandLen  = 6
	inviteCodeDays     = 180
	inviteMaxMembers   = 1
)

// OutboundStatusDeps — read-only availability of the outbound channel (used by the
// public gate config).
type OutboundStatusDeps struct {
	Proxy OutboundStatus
}

// CanDeliverCodes — whether the owner has a working outbound channel that can get an
// issued code to the requester. gate uses this to decide whether to show the "request
// access" block at all: don't let a visitor fill in a form that can't go anywhere.
// A read failure is treated as "cannot deliver" (conservative + no error leaks to the
// public endpoint).
func CanDeliverCodes(ctx context.Context, deps OutboundStatusDeps, ownerID string) bool {
	if ownerID == "" {
		return false
	}
	ok, err := deps.Proxy.Connected(ctx, ownerID)
	if err != nil {
		return false
	}
	return ok
}

// ApproveRequestDeps — dependencies for the approve loop (spans requests / codes / roles /
// owners + the mail job).
type ApproveRequestDeps struct {
	Reqs   *access.RequestRepo
	Roles  *access.RoleRepo
	Owners *repo.Repo
	Proxy  OutboundStatus
	Jobs   MailJobs
	Events events.Recorder
}

// ApproveResult — the issued code and link, and the delivery's receipt.
type ApproveResult struct {
	Code string
	Link string
	Mail entity.NoticeReceipt
}

// ApproveAccessRequest — approve a gate request: issue an AccessCode and queue its delivery to
// the requester (code + /<page>?code= link), then wait briefly for the send. The outbound channel
// must already be available, otherwise ErrOutboundNotConfigured, synchronously (don't issue a
// code that can't be delivered — a code nobody was told about is worse than no code).
func ApproveAccessRequest(
	ctx context.Context, deps ApproveRequestDeps, ownerID, requestID string,
) (ApproveResult, error) {
	c, err := loadApprovalContext(ctx, deps, ownerID, requestID)
	if err != nil {
		return ApproveResult{}, err
	}
	invited, err := deps.Roles.GetByName(ctx, ownerID, access.InvitedRoleName)
	if err != nil {
		return ApproveResult{}, fmt.Errorf("get invited role: %w", err)
	}
	code, err := generateInviteCode()
	if err != nil {
		return ApproveResult{}, err
	}
	var job jobs.JobID
	err = pgstore.InTx(ctx, deps.Reqs.Pool(), func(tx pgstore.Tx) error {
		var terr error
		job, terr = issueAndQueue(ctx, deps, tx, &issue{
			ownerID: ownerID, requestID: requestID, code: code, roleID: invited.ID(),
		})
		return terr
	})
	if err != nil {
		return ApproveResult{}, fmt.Errorf("issue code: %w", err)
	}
	return ApproveResult{
		Code: code, Link: CodeLink(c.owner.PublicURL, code), Mail: awaitMail(ctx, deps.Jobs, job),
	}, nil
}

type issue struct {
	ownerID, requestID, code, roleID string
}

// issueAndQueue — the code, its mail job and the request's pointer to that job, in one
// transaction.
//
// The code attaches `invited`, not `public`: the owner just **personally agreed** to talk to this
// person, which is exactly a targeted invitation. Attaching `public` would give the approved
// person the same access they'd have had without ever asking.
func issueAndQueue(
	ctx context.Context, deps ApproveRequestDeps, tx pgstore.Tx, in *issue,
) (jobs.JobID, error) {
	expires := time.Now().AddDate(0, 0, inviteCodeDays)
	maxMembers := int32(inviteMaxMembers)
	issued, err := access.CreateAccessCodeTx(ctx, tx, &access.CreateAccessCodeInput{
		OwnerID: in.ownerID, Code: in.code, Label: "invite",
		Purpose: "access request approval", AssumedRoleID: in.roleID,
		ExpiresAt: &expires, MaxMembers: &maxMembers,
	})
	if err != nil {
		return 0, fmt.Errorf("create access code: %w", err)
	}
	args := entity.ApprovalNoticeArgs{
		OwnerID: in.ownerID, RequestID: in.requestID, CodeID: issued.ID,
	}
	job, err := deps.Jobs.With(tx).Enqueue(ctx, entity.ApprovalNoticeKind, args, jobs.EnqueueOpts{})
	if err != nil {
		return 0, fmt.Errorf("queue approval mail: %w", err)
	}
	if err = deps.Reqs.With(tx).SetMailJob(ctx, in.ownerID, in.requestID, int64(job)); err != nil {
		return 0, fmt.Errorf("record approval mail job: %w", err)
	}
	return job, recordApproval(ctx, deps.Events.With(tx), in, issued.ID)
}

// recordApproval —— code.issued and access_request.approved, on the approval's transaction.
//
//nolint:wrapcheck // Record names the type
func recordApproval(ctx context.Context, rec events.Recorder, in *issue, codeID string) error {
	if err := access.RecordCodeEvent(ctx, rec, access.CodeIssued, in.ownerID, codeID); err != nil {
		return err
	}
	data := map[string]string{"request_id": in.requestID, "code_id": codeID}
	return rec.Record(ctx, in.ownerID, access.AccessRequestApproved,
		"access_request/"+in.requestID, data)
}

type approvalContext struct {
	owner entity.Owner
}

// loadApprovalContext — delivery must be possible and the request must exist, before anything is
// issued.
func loadApprovalContext(
	ctx context.Context, deps ApproveRequestDeps, ownerID, requestID string,
) (approvalContext, error) {
	ok, err := deps.Proxy.Connected(ctx, ownerID)
	if err != nil {
		return approvalContext{}, fmt.Errorf("outbound channel status: %w", err)
	}
	if !ok {
		return approvalContext{}, ErrOutboundNotConfigured
	}
	if _, rerr := deps.Reqs.GetByID(ctx, ownerID, requestID); rerr != nil {
		return approvalContext{}, fmt.Errorf("get access request: %w", rerr)
	}
	ownerRow, oerr := deps.Owners.GetByID(ctx, ownerID)
	if oerr != nil {
		return approvalContext{}, fmt.Errorf("get owner: %w", oerr)
	}
	return approvalContext{owner: ownerRow}, nil
}

// generateInviteCode — "inv-XXXXXX" lowercase base32 (URL-safe, eyeball-readable),
// the same pattern as an application code.
func generateInviteCode() (string, error) {
	buf := make([]byte, inviteCodeRandSize)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("read random: %w", err)
	}
	enc := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf)
	return inviteCodePrefix + "-" + strings.ToLower(enc)[:inviteCodeRandLen], nil
}
