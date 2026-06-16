// visitor_turn_quota.go —— per-session turn quota preflight check.
//
// 老 SendMessage 在 server-side agent loop 前查这个；G-Y.6 pi-pivot 后
// /messages 路由没了，改成 /dialogs commit 前 check 一次。

package usecases

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

// TurnQuotaInput —— EnforceTurnQuota 入参 (拆出来让外部 caller pi-pivot
// /inference/stream 一行调进来)。
type TurnQuotaInput struct {
	OwnerID        string
	ConversationID string
}

// EnforceTurnQuota —— 检查 turns/session 配额。返:
//   - nil = OK 继续
//   - domain.ErrTurnQuotaReached = 已用完 max_turns_per_session
//   - domain.ErrCodeInvalid = code 被 revoke
//   - 其他 = DB error
func EnforceTurnQuota(
	ctx context.Context, deps *VisitorDeps, in *TurnQuotaInput,
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
	ctx context.Context, deps *VisitorDeps, conv *domain.Chat, codeID string,
) error {
	code, cerr := deps.Codes.GetByID(ctx, codeID)
	if cerr != nil {
		return turnQuotaCodeErr(cerr)
	}
	if code.Status == "revoked" {
		return domain.ErrCodeInvalid
	}
	return turnQuotaCheck(ctx, deps, &code, conv)
}

func turnQuotaCodeErr(err error) error {
	if errors.Is(err, domain.ErrCodeInvalid) {
		return nil
	}
	return fmt.Errorf("load code for quota: %w", err)
}

func turnQuotaCheck(
	ctx context.Context, deps *VisitorDeps, code *domain.AccessCode, conv *domain.Chat,
) error {
	if code.MaxTurnsPerSession == nil || *code.MaxTurnsPerSession <= 0 {
		return nil
	}
	count, err := countTurnsForQuota(ctx, deps, conv)
	if err != nil {
		return fmt.Errorf("count turns: %w", err)
	}
	if count >= *code.MaxTurnsPerSession {
		return domain.ErrTurnQuotaReached
	}
	return nil
}

// countTurnsForQuota —— member 级配额:有 member 就汇总该人全部对话的访客发言
// (多段对话共享预算);无 member(anon / public)退回按单段对话数。
func countTurnsForQuota(
	ctx context.Context, deps *VisitorDeps, conv *domain.Chat,
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
