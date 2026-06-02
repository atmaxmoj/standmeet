// visitor_turn_quota.go —— per-session turn quota preflight check.
//
// 老 SendMessage 在 server-side agent loop 前查这个；G-Y.6 pi-pivot 后
// /messages 路由没了，改成 /dialogs commit 前 check 一次。
// EndedAt 也在这里查 —— 已 summary 的 conversation 不让继续发。

package usecases

import (
	"context"
	"errors"
	"fmt"

	"github.com/wangsijie/standmeet/internal/domain"
)

// TurnQuotaInput —— EnforceTurnQuota 入参 (拆出来让外部 caller pi-pivot
// /inference/stream 一行调进来)。
type TurnQuotaInput struct {
	OwnerID        string
	ConversationID string
}

// EnforceTurnQuota —— 检查 conversation 状态 + turns/session。返:
//   - nil = OK 继续
//   - domain.ErrChatEnded = /summary 写过了
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
	if conv.EndedAt != nil {
		return domain.ErrChatEnded
	}
	if conv.CodeID == nil {
		return nil
	}
	return enforceTurnQuotaForCode(ctx, deps, in, *conv.CodeID)
}

func enforceTurnQuotaForCode(
	ctx context.Context, deps *VisitorDeps, in *TurnQuotaInput, codeID string,
) error {
	code, cerr := deps.Codes.GetByID(ctx, codeID)
	if cerr != nil {
		return turnQuotaCodeErr(cerr)
	}
	if code.Status == "revoked" {
		return domain.ErrCodeInvalid
	}
	return turnQuotaCheck(ctx, deps, &code, in.ConversationID)
}

func turnQuotaCodeErr(err error) error {
	if errors.Is(err, domain.ErrCodeInvalid) {
		return nil
	}
	return fmt.Errorf("load code for quota: %w", err)
}

func turnQuotaCheck(
	ctx context.Context, deps *VisitorDeps, code *domain.AccessCode, convID string,
) error {
	if code.MaxTurnsPerSession == nil || *code.MaxTurnsPerSession <= 0 {
		return nil
	}
	count, err := deps.Chats.CountVisitorTurns(ctx, convID)
	if err != nil {
		return fmt.Errorf("count turns: %w", err)
	}
	if count >= *code.MaxTurnsPerSession {
		return domain.ErrTurnQuotaReached
	}
	return nil
}
