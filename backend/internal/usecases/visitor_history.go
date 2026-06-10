// visitor_history.go —— 刷新恢复:按 session 的 member 拉回它 open chat 的 Q&A,
// 配对成 dialog 列表给前端重建 transcript。member → open chat(不信 URL),所以
// 访客只看到自己那段。citation 暂不带(先保 Q&A 文本)。

package usecases

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres"
	"github.com/atmaxmoj/standmeet/internal/session"
)

// VisitorDialog —— 一段历史交换:问 + 答。
type VisitorDialog struct {
	Question string
	Answer   string
}

// VisitorSnapshot —— 载入时的权威快照:历史 Q&A + 实时配额/身份。前端据此在每次
// load 时 reconcile 本地 localStorage 缓存(用 / max / 名额 / 名字)—— 后端
// conversation + code 是唯一 source of truth,客户端不该信任自增的脏值。
type VisitorSnapshot struct {
	VisitorName string
	Dialogs     []VisitorDialog
	UsedTurns   int
	MemberCount int
	MaxTurns    int32
	MaxMembers  int32
}

// BuildVisitorSnapshot —— 凭 session data(member / code / 名字)拼出权威快照:
//   - Dialogs / UsedTurns ← member 的 open chat 里 visitor 句数
//   - MaxTurns / MaxMembers / MemberCount ← 这张 code 当前配置(owner 改了就
//     下次 load 纠回)
//   - VisitorName ← session 里冻结的名字
//
// 无 code(public / byoai tier)→ 配额字段留 0。code 查不到(被删)→ 同样留 0,
// 不报错(dialogs 仍可返回)。
func BuildVisitorSnapshot(
	ctx context.Context, deps *VisitorDeps, data *session.VisitorSessionData,
) (VisitorSnapshot, error) {
	dialogs, err := VisitorHistory(ctx, deps.Chats, data.MemberID, data.OwnerID)
	if err != nil {
		return VisitorSnapshot{}, err
	}
	snap := VisitorSnapshot{
		Dialogs: dialogs, UsedTurns: len(dialogs), VisitorName: data.VisitorName,
	}
	applyCodeQuota(ctx, deps, data.CodeID, &snap)
	return snap, nil
}

func applyCodeQuota(
	ctx context.Context, deps *VisitorDeps, codeID string, snap *VisitorSnapshot,
) {
	if codeID == "" {
		return
	}
	code, err := deps.Codes.GetByID(ctx, codeID)
	if err != nil {
		return
	}
	snap.MaxTurns = posInt32(code.MaxTurnsPerSession)
	snap.MaxMembers = posInt32(code.MaxMembers)
	snap.MemberCount = countCodeMembers(ctx, deps, codeID)
}

// posInt32 —— *int32 取正值,nil / ≤0 → 0(0 = 不限,前端不画 gauge)。
func posInt32(p *int32) int32 {
	if p != nil && *p > 0 {
		return *p
	}
	return 0
}

func countCodeMembers(ctx context.Context, deps *VisitorDeps, codeID string) int {
	members, err := deps.Codes.ListMembers(ctx, codeID)
	if err != nil {
		return 0
	}
	return len(members)
}

// VisitorHistory —— member → open chat → messages → 配对。还没开会
// (ErrChatNotFound)→ 空列表(不是错误)。
func VisitorHistory(
	ctx context.Context, chats *postgres.ChatRepo, memberID, ownerID string,
) ([]VisitorDialog, error) {
	if memberID == "" {
		return []VisitorDialog{}, nil
	}
	chat, err := chats.GetOpenChatByMember(ctx, memberID)
	if errors.Is(err, domain.ErrChatNotFound) {
		return []VisitorDialog{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("history open chat: %w", err)
	}
	bundle, err := chats.GetWithMessages(ctx, ownerID, chat.ID)
	if err != nil {
		return nil, fmt.Errorf("history messages: %w", err)
	}
	return pairVisitorDialogs(bundle.Messages), nil
}

// pairVisitorDialogs —— messages(按时间序)里每条 visitor 问句配它后面那条
// assistant 答(没有就空 answer,如出错的 turn)。
func pairVisitorDialogs(msgs []domain.Message) []VisitorDialog {
	out := make([]VisitorDialog, 0, len(msgs))
	for i := range msgs {
		if msgs[i].Role == "visitor" {
			out = append(out, VisitorDialog{
				Question: msgs[i].Body, Answer: answerAfter(msgs, i),
			})
		}
	}
	return out
}

func answerAfter(msgs []domain.Message, i int) string {
	if i+1 < len(msgs) && msgs[i+1].Role == "assistant" {
		return msgs[i+1].Body
	}
	return ""
}
