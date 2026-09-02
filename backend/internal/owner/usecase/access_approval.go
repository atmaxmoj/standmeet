// access_approval.go — approve a gate access request: issue an AccessCode, and **deliver**
// it to the requester.
//
// Issuing the code is core business (AccessCode is the product's own thing); **how it gets
// delivered is not**. Delivery goes only through `OutboundSender` — one recipient, one title
// line, one body. This package therefore never knows whether the other side is email, IM,
// or something else, nor which connector the owner has configured.

package usecase

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"fmt"
	"strings"
	"time"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
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

// Use ErrOutboundNotConfigured (see outbound.go) when delivery is impossible — the
// core's own sentinel.

// OutboundStatusDeps — read-only availability of the outbound channel (used by the
// public gate config).
type OutboundStatusDeps struct {
	Proxy OutboundSender
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
// owners + the outbound port).
// Proxy handles two things through one port: the "can it be delivered" precheck (Connected),
// and actually sending the notice (Send).
type ApproveRequestDeps struct {
	Reqs   *access.RequestRepo
	Codes  *access.CodeRepo
	Roles  *access.RoleRepo
	Owners *repo.Repo
	Proxy  OutboundSender
}

// ApproveResult — result of the issue-code loop (shown back in the admin UI).
type ApproveResult struct {
	Code string
	Link string
}

// ApproveAccessRequest — approve a gate request: issue an AccessCode + deliver it to the
// requester (code + /<page>?code= link) + set status to replied. The outbound channel must
// already be available, otherwise ErrOutboundNotConfigured (don't issue a code that can't be
// delivered — a code nobody was told about is worse than no code).
func ApproveAccessRequest(
	ctx context.Context, deps ApproveRequestDeps, ownerID, requestID string,
) (ApproveResult, error) {
	prep, err := prepareApproval(ctx, deps, ownerID, requestID)
	if err != nil {
		return ApproveResult{}, err
	}
	if serr := deps.Proxy.Send(ctx, ownerID, prep.msg); serr != nil {
		return ApproveResult{}, fmt.Errorf("send approval notice: %w", serr)
	}
	if _, uerr := deps.Reqs.UpdateStatus(ctx, ownerID, requestID, "replied"); uerr != nil {
		return ApproveResult{}, fmt.Errorf("mark request replied: %w", uerr)
	}
	return ApproveResult{Code: prep.code, Link: prep.link}, nil
}

type approvalPrep struct {
	msg  OutboundNotice
	code string
	link string
}

func prepareApproval(
	ctx context.Context, deps ApproveRequestDeps, ownerID, requestID string,
) (approvalPrep, error) {
	c, err := loadApprovalContext(ctx, deps, ownerID, requestID)
	if err != nil {
		return approvalPrep{}, err
	}
	code, cerr := issueInviteCode(ctx, deps, ownerID)
	if cerr != nil {
		return approvalPrep{}, cerr
	}
	link := buildCodeLink(c.owner.PublicURL, code)
	return approvalPrep{
		code: code, link: link,
		msg: buildApprovalNotice(&c.req, code, link),
	}, nil
}

type approvalContext struct {
	req   access.Request
	owner entity.Owner
}

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
	req, rerr := deps.Reqs.GetByID(ctx, ownerID, requestID)
	if rerr != nil {
		return approvalContext{}, fmt.Errorf("get access request: %w", rerr)
	}
	ownerRow, oerr := deps.Owners.GetByID(ctx, ownerID)
	if oerr != nil {
		return approvalContext{}, fmt.Errorf("get owner: %w", oerr)
	}
	return approvalContext{req: req, owner: ownerRow}, nil
}

// issueInviteCode — the owner approved a gate request, so the product issues a code for them.
//
// It attaches `invited`, not `public`: the owner just **personally agreed** to talk to this
// person, which is exactly a targeted invitation. Attaching `public` would give the approved
// person the same access they'd have had without ever asking, now that public has been
// narrowed to "read only what's published".
func issueInviteCode(ctx context.Context, deps ApproveRequestDeps, ownerID string) (string, error) {
	invited, verr := deps.Roles.GetByName(ctx, ownerID, access.InvitedRoleName)
	if verr != nil {
		return "", fmt.Errorf("get invited role: %w", verr)
	}
	code, gerr := generateInviteCode()
	if gerr != nil {
		return "", gerr
	}
	expires := time.Now().AddDate(0, 0, inviteCodeDays)
	maxMembers := int32(inviteMaxMembers)
	if _, cerr := deps.Codes.CreateAccessCode(ctx, &access.CreateAccessCodeInput{
		OwnerID: ownerID, Code: code, Label: "invite",
		Purpose: "access request approval", AssumedRoleID: invited.ID(),
		ExpiresAt: &expires, MaxMembers: &maxMembers,
	}); cerr != nil {
		return "", fmt.Errorf("create access code: %w", cerr)
	}
	return code, nil
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

func buildCodeLink(publicURL, code string) string {
	return strings.TrimRight(publicURL, "/") + "?code=" + code
}

// buildApprovalNotice — the notice's **content** belongs to the product (it's StandMeet
// telling the requester they got a code), so it lives in the core. What belongs to the
// channel is "how to send it", and that step sits behind OutboundSender.
func buildApprovalNotice(req *access.Request, code, link string) OutboundNotice {
	greeting := "Hi there,"
	if req.Name != "" {
		greeting = "Hi " + req.Name + ","
	}
	body := greeting + "\n\n" +
		"Your request for access has been approved. Here is your access code:\n\n" +
		"    " + code + "\n\n" +
		"Open this link to start the conversation (the code is already filled in):\n\n" +
		"    " + link + "\n\n" +
		"Sent via StandMeet."
	return OutboundNotice{
		To:    req.Email,
		Title: "Your access request has been approved",
		Body:  body,
	}
}
