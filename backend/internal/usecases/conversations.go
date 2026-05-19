// conversations.go —— admin 视角的 conversation list / transcript 查询。
// 业务逻辑薄到几乎只是 repo 转发 + 默认参数 clamp；这里独立成 use case 是
// 为了和 routes 层解耦，未来加 "filter / search / pagination" 不污染 handler。

package usecases

import (
	"context"
	"fmt"

	"github.com/wangsijie/standmeet/internal/postgres"
)

// ConversationsDeps —— ListConversations / GetTranscript 需要的 repo。
type ConversationsDeps struct {
	Conv *postgres.ConversationRepo
}

const (
	defaultConvListLimit = 50
	maxConvListLimit     = 200
)

// ListConversations —— admin 列 owner 所有 conversation。limit ≤ 0 用默认；
// 超 max 截断。
func ListConversations(
	ctx context.Context, deps ConversationsDeps, ownerID string, limit int32,
) ([]postgres.ConvSummary, error) {
	if ownerID == "" {
		return nil, ErrEmptyField
	}
	rows, err := deps.Conv.ListByOwner(ctx, ownerID, clampConvLimit(limit))
	if err != nil {
		return nil, fmt.Errorf("list conversations: %w", err)
	}
	return rows, nil
}

// GetConversationTranscript —— 拿 conversation + messages 全量。convID 不存在
// 或不属于 owner 返 domain.ErrConversationNotFound。
func GetConversationTranscript(
	ctx context.Context, deps ConversationsDeps, ownerID, convID string,
) (postgres.ConversationWithMessages, error) {
	if ownerID == "" || convID == "" {
		return postgres.ConversationWithMessages{}, ErrEmptyField
	}
	out, err := deps.Conv.GetWithMessages(ctx, ownerID, convID)
	if err != nil {
		return postgres.ConversationWithMessages{}, fmt.Errorf("get transcript: %w", err)
	}
	return out, nil
}

func clampConvLimit(n int32) int32 {
	if n <= 0 {
		return defaultConvListLimit
	}
	if n > maxConvListLimit {
		return maxConvListLimit
	}
	return n
}
