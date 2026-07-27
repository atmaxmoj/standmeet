// chats_admin.go —— ChatRepo 的 admin 读侧 (list + transcript)。从 chats.go
// 拆出来守 max-lines 350 cap。chats.go 留 CRUD + AppendDialog (write 路径)。

package conversation

import (
	"context"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/infra/postgres/dbq"
)

// ChatSummary —— admin list 用的 chat 摘要（含 code label 关联）。
// 字段顺序按 govet fieldalignment：time.Time 在前、pointer、string、数值、bool。
type ChatSummary struct {
	StartedAt   time.Time
	LastAt      time.Time
	CodeID      *string
	CodeLabel   *string
	CodeValue   *string
	ID          string
	Mode        string
	VisitorName string
	ClientIP    string // 访客来源 IP（IP 感知）；空 = 未知
	Turns       int32  // 从 messages 派生(数 visitor role),不是存储字段
	PrivateHits int32
}

// ChatWithMessages —— GetWithMessages 返回的 transcript bundle。
type ChatWithMessages struct {
	Chat     Chat
	Messages []Message
}

// ListByOwner —— admin 列 owner 所有 chat 摘要（按 last_at DESC）。
func (r *ChatRepo) ListByOwner(
	ctx context.Context, ownerID string, limit int32,
) ([]ChatSummary, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	q := dbq.New(r.pool)
	rows, qerr := q.ListConversationsByOwner(ctx, dbq.ListConversationsByOwnerParams{
		OwnerID: ownerUUID, Limit: limit,
	})
	if qerr != nil {
		return nil, fmt.Errorf("list chats: %w", qerr)
	}
	out := make([]ChatSummary, 0, len(rows))
	for i := range rows {
		out = append(out, toChatSummary(&rows[i]))
	}
	return out, nil
}

// GetWithMessages —— 拿 chat + 全部 messages（admin transcript 查看）。
// 不命中 chat 返 ErrChatNotFound（owner_id mismatch 也走这条分支，
// 避免暴露 "存在但不属于你"）。
func (r *ChatRepo) GetWithMessages(
	ctx context.Context, ownerID, chatID string,
) (ChatWithMessages, error) {
	chat, cerr := r.GetChat(ctx, ownerID, chatID)
	if cerr != nil {
		return ChatWithMessages{}, cerr
	}
	msgs, mlerr := r.loadMessages(ctx, chatID)
	if mlerr != nil {
		return ChatWithMessages{}, mlerr
	}
	return ChatWithMessages{Chat: chat, Messages: msgs}, nil
}

func (r *ChatRepo) loadMessages(
	ctx context.Context, chatID string,
) ([]Message, error) {
	chatUUID, perr := pgstore.ParseUUID(chatID)
	if perr != nil {
		return nil, fmt.Errorf("parse chat id: %w", perr)
	}
	q := dbq.New(r.pool)
	rows, lerr := q.ListMessages(ctx, chatUUID)
	if lerr != nil {
		return nil, fmt.Errorf("list messages: %w", lerr)
	}
	out := make([]Message, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainMessage(&rows[i]))
	}
	return out, nil
}

func toChatSummary(row *dbq.ListConversationsByOwnerRow) ChatSummary {
	out := ChatSummary{
		ID:          pgstore.FormatUUID(row.ID),
		Mode:        row.Mode,
		VisitorName: row.VisitorName,
		StartedAt:   row.StartedAt.Time,
		LastAt:      row.LastAt.Time,
		Turns:       row.TurnCount,
		ClientIP:    row.ClientIp,
		CodeLabel:   row.CodeLabel,
		CodeValue:   row.CodeValue,
	}
	if row.CodeID.Valid {
		s := pgstore.FormatUUID(row.CodeID)
		out.CodeID = &s
	}
	return out
}
