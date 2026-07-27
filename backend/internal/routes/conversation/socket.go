// Package conversation —— socket controller:conversation.read host op。断网沙箱 cap 经 socket 读本
// 会话的 owner-scoped transcript。按业务分类:它跟 conversation 的其它代码住一起,不进机制 bucket。
// capsocket 只是那根传输;cmd 按每个 cap 挂它允许的 op。
package conversation

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capsocket"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
)

// SockMessage —— socket op 交换的一条消息(role/content;避开 inference/domain 包耦合)。
type SockMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// Getter —— 读一次会话的 owner-scoped transcript(消费侧窄口,组装根注入 chatRepo)。
type Getter interface {
	GetWithMessages(
		ctx context.Context, ownerID, chatID string,
	) (conversation.ChatWithMessages, error)
}

// RegisterConversationReadOp —— 把 "conversation.read" 挂到 srv:{owner_id,conversation_id} →
// GetWithMessages → {messages:[{role,content}]}。
func RegisterConversationReadOp(srv *capsocket.Server, chats Getter) {
	srv.Handle("conversation.read", func(
		ctx context.Context, raw json.RawMessage,
	) (json.RawMessage, error) {
		return runConversationRead(ctx, chats, raw)
	})
}

func runConversationRead(
	ctx context.Context, chats Getter, raw json.RawMessage,
) (json.RawMessage, error) {
	var req struct {
		OwnerID        string `json:"owner_id"`
		ConversationID string `json:"conversation_id"`
	}
	if err := json.Unmarshal(raw, &req); err != nil {
		return nil, fmt.Errorf("conversation.read: decode: %w", err)
	}
	bundle, err := chats.GetWithMessages(ctx, req.OwnerID, req.ConversationID)
	if err != nil {
		return nil, fmt.Errorf("conversation.read: %w", err)
	}
	msgs := make([]SockMessage, len(bundle.Messages))
	for i := range bundle.Messages {
		m := bundle.Messages[i]
		msgs[i] = SockMessage{Role: m.Role, Content: m.Body}
	}
	out, merr := json.Marshal(map[string][]SockMessage{"messages": msgs})
	if merr != nil {
		return nil, fmt.Errorf("conversation.read: marshal: %w", merr)
	}
	return out, nil
}
