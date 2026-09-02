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
