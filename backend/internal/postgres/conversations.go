// conversations.go —— admin 视角下的 conversation 列表 / transcript 查询。
// CRUD（CreateConversation / AppendMessage 等）仍在 codes.go，跟 access_codes
// 同 lifecycle。这里只放 owner-facing 读 path。

package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres/dbq"
)

// ConvSummary —— admin list 用的 conversation 摘要（含 code label 关联）。
// 字段顺序按 govet fieldalignment：time.Time 在前、pointer、string、数值、bool。
type ConvSummary struct {
	StartedAt    time.Time
	LastAt       time.Time
	CodeID       *string
	CodeLabel    *string
	CodeValue    *string
	ID           string
	Tier         string
	VisitorName  string
	MessageCount int32
	HitPrivate   bool
}

// ConversationWithMessages —— GetWithMessages 返回的 transcript bundle。
type ConversationWithMessages struct {
	Conversation domain.Conversation
	Messages     []domain.Message
}

// ListByOwner —— admin 列 owner 所有 conversation 摘要（按 last_at DESC）。
func (r *ConversationRepo) ListByOwner(
	ctx context.Context, ownerID string, limit int32,
) ([]ConvSummary, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	q := dbq.New(r.pool)
	rows, qerr := q.ListConversationsByOwner(ctx, dbq.ListConversationsByOwnerParams{
		OwnerID: ownerUUID, Limit: limit,
	})
	if qerr != nil {
		return nil, fmt.Errorf("list conversations: %w", qerr)
	}
	out := make([]ConvSummary, 0, len(rows))
	for i := range rows {
		out = append(out, toConvSummary(&rows[i]))
	}
	return out, nil
}

// GetWithMessages —— 拿 conversation + 全部 messages（admin transcript 查看）。
// 不命中 conversation 返 domain.ErrConversationNotFound（owner_id mismatch
// 也走这条分支，避免暴露 "存在但不属于你"）。
func (r *ConversationRepo) GetWithMessages(
	ctx context.Context, ownerID, convID string,
) (ConversationWithMessages, error) {
	conv, cerr := r.GetConversation(ctx, ownerID, convID)
	if cerr != nil {
		return ConversationWithMessages{}, cerr
	}
	msgs, mlerr := r.loadMessages(ctx, convID)
	if mlerr != nil {
		return ConversationWithMessages{}, mlerr
	}
	return ConversationWithMessages{Conversation: conv, Messages: msgs}, nil
}

func (r *ConversationRepo) loadMessages(
	ctx context.Context, convID string,
) ([]domain.Message, error) {
	convUUID, perr := parseUUID(convID)
	if perr != nil {
		return nil, fmt.Errorf("parse conv id: %w", perr)
	}
	q := dbq.New(r.pool)
	rows, lerr := q.ListMessages(ctx, convUUID)
	if lerr != nil {
		return nil, fmt.Errorf("list messages: %w", lerr)
	}
	out := make([]domain.Message, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainMessage(&rows[i]))
	}
	return out, nil
}

func toConvSummary(row *dbq.ListConversationsByOwnerRow) ConvSummary {
	out := ConvSummary{
		ID:           formatUUID(row.ID),
		Tier:         row.Tier,
		VisitorName:  row.VisitorName,
		StartedAt:    row.StartedAt.Time,
		LastAt:       row.LastAt.Time,
		MessageCount: row.MessageCount,
		HitPrivate:   row.HitPrivate,
		CodeLabel:    row.CodeLabel,
		CodeValue:    row.CodeValue,
	}
	if row.CodeID.Valid {
		s := formatUUID(row.CodeID)
		out.CodeID = &s
	}
	return out
}
