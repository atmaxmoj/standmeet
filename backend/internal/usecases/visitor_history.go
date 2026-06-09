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
)

// VisitorDialog —— 一段历史交换:问 + 答。
type VisitorDialog struct {
	Question string
	Answer   string
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
