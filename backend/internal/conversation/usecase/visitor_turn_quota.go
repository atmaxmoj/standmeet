// visitor_turn_quota.go —— per-session turn quota preflight check.
//
// The old SendMessage checked this before the server-side agent loop; after the
// G-Y.6 pi-pivot the /messages route is gone, and it's now checked once before
// /dialogs commit instead.

package usecase

import (
	"context"
	"errors"
	"fmt"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/conversation/entity"
)

// TurnQuotaInput —— input for EnforceTurnQuota (split out so an external caller in
// pi-pivot's /inference/stream can call it in one line).
type TurnQuotaInput struct {
	OwnerID        string
	ConversationID string
}

// EnforceTurnQuota —— checks the turns/session quota. Returns:
//   - nil = OK, proceed
//   - access.ErrTurnQuotaReached = max_turns_per_session already used up
//   - access.ErrCodeInvalid = the code was revoked
//   - other = a DB error
func EnforceTurnQuota(
	ctx context.Context, deps *VisitorSessionDeps, in *TurnQuotaInput,
) error {
	conv, err := deps.Chats.GetChat(ctx, in.OwnerID, in.ConversationID)
	if err != nil {
		return fmt.Errorf("load conv for quota: %w", err)
	}
	if conv.CodeID == nil {
		return nil
	}
	return enforceTurnQuotaForCode(ctx, deps, &conv, *conv.CodeID)
}

func enforceTurnQuotaForCode(
	ctx context.Context, deps *VisitorSessionDeps, conv *entity.Chat, codeID string,
) error {
	code, cerr := deps.Codes.GetByID(ctx, codeID)
	if cerr != nil {
		return turnQuotaCodeErr(cerr)
	}
	if code.Status == "revoked" {
		return access.ErrCodeInvalid
	}
	return turnQuotaCheck(ctx, deps, &code, conv)
}

func turnQuotaCodeErr(err error) error {
	if errors.Is(err, access.ErrCodeInvalid) {
		return nil
	}
	return fmt.Errorf("load code for quota: %w", err)
}

func turnQuotaCheck(
	ctx context.Context, deps *VisitorSessionDeps, code *access.Code,
	conv *entity.Chat,
) error {
	if code.MaxTurnsPerSession == nil || *code.MaxTurnsPerSession <= 0 {
		return nil
	}
	count, err := countTurnsForQuota(ctx, deps, conv)
	if err != nil {
		return fmt.Errorf("count turns: %w", err)
	}
	if count >= *code.MaxTurnsPerSession {
		return access.ErrTurnQuotaReached
	}
	return nil
}

// countTurnsForQuota —— member-level quota: if there's a member, sums that person's
// visitor turns across all conversations (multi-conversation shares one budget); no
// member (anon / public) falls back to counting the single conversation.
func countTurnsForQuota(
	ctx context.Context, deps *VisitorSessionDeps, conv *entity.Chat,
) (int32, error) {
	if conv.MemberID != nil && *conv.MemberID != "" {
		n, err := deps.Chats.CountVisitorTurnsForMember(ctx, *conv.MemberID)
		if err != nil {
			return 0, fmt.Errorf("count member turns: %w", err)
		}
		return n, nil
	}
	n, err := deps.Chats.CountVisitorTurns(ctx, conv.ID)
	if err != nil {
		return 0, fmt.Errorf("count conv turns: %w", err)
	}
	return n, nil
}

// SessionQuota —— the turn quota for the current conversation; used by the visitor UI to
// render what's remaining. MaxTurns == 0 means unlimited (the owner didn't set
// max_turns_per_session on the code). UsedTurns starts at 0 (new conv); after each
// subsequent sendMessage the frontend increments it locally, no need for SSE to echo it
// back (a single visitor session grows linearly, the client can count it exactly).
type SessionQuota struct {
	MaxTurns  int32 `json:"max_turns"`
	UsedTurns int32 `json:"used_turns"`
	// MaxMembers —— how many names this code allows at most (0 = unlimited); the
	// visitor UI pairs it with the members count to render "N of M names".
	MaxMembers int32 `json:"max_members"`
}

// codeSessionQuotaWithUsed —— on top of the static quota (max), fills in UsedTurns by
// actually counting it from the backend. Under the new model the quota is member-level:
// UsedTurns sums this member's visitor turns across **all conversations**
// (countTurnsForQuota); on resume / multi-surface issuance it reports the true total,
// no longer stuck at 0 nor counted per single conversation segment. Uncountable (DB
// hiccup) → falls back to 0.
func codeSessionQuotaWithUsed(
	ctx context.Context, deps *VisitorSessionDeps, code *access.Code,
	conv *entity.Chat,
) SessionQuota {
	q := codeSessionQuota(code)
	if used, err := countTurnsForQuota(ctx, deps, conv); err == nil {
		q.UsedTurns = used
	}
	return q
}

func codeSessionQuota(code *access.Code) SessionQuota {
	q := SessionQuota{}
	if code.MaxTurnsPerSession != nil && *code.MaxTurnsPerSession > 0 {
		q.MaxTurns = *code.MaxTurnsPerSession
	}
	if code.MaxMembers != nil && *code.MaxMembers > 0 {
		q.MaxMembers = *code.MaxMembers
	}
	return q
}
