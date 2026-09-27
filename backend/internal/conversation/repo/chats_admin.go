// chats_admin.go — ChatRepo's admin read side (list + transcript). Split out of
// chats.go to hold the max-lines 350 cap. chats.go keeps CRUD + AppendDialog (write path).

package repo

import (
	"context"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/conversation/db"
	"github.com/atmaxmoj/standmeet/internal/conversation/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/paging"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// ChatSummary — chat summary for the admin list (includes the code label association).
// Field order follows govet fieldalignment: time.Time first, then pointer, string,
// numeric, bool.
type ChatSummary struct {
	StartedAt   time.Time
	LastAt      time.Time
	CodeID      *string
	CodeLabel   *string
	CodeValue   *string
	ID          string
	Mode        string
	VisitorName string
	ClientIP    string // Visitor source IP (IP-aware); empty = unknown
	Turns       int32  // Derived from messages (counts visitor role), not a stored field
	PrivateHits int32
}

// ChatWithMessages — the transcript bundle returned by GetWithMessages.
type ChatWithMessages struct {
	Chat     entity.Chat
	Messages []entity.Message
}

// ListPage — one page of an owner's chat summaries, most recent activity first, optionally
// only those on one code string. The page reports the matching total.
func (r *ChatRepo) ListPage(
	ctx context.Context, ownerID, code string, req paging.Request,
) (paging.Page[ChatSummary], error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return paging.Page[ChatSummary]{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	after, err := pgstore.CursorArgs(req.After)
	if err != nil {
		return paging.Page[ChatSummary]{}, fmt.Errorf("list chats: %w", err)
	}
	rows, qerr := db.New(r.pool).ListConversationsPage(ctx, db.ListConversationsPageParams{
		OwnerID: ownerUUID, Code: code, AfterAt: after.At, AfterID: after.ID, Lim: req.Fetch(),
	})
	if qerr != nil {
		return paging.Page[ChatSummary]{}, fmt.Errorf("list chats: %w", qerr)
	}
	out := make([]ChatSummary, 0, len(rows))
	total := int32(0)
	for i := range rows {
		out = append(out, toChatSummary(&rows[i]))
		total = rows[i].Total
	}
	page := paging.Cut(out, req, func(c *ChatSummary) paging.Cursor {
		return paging.Cursor{At: c.LastAt, ID: c.ID}
	})
	return page.WithTotal(total), nil
}

// GetWithMessages — fetches a chat + all its messages (admin transcript view).
// Chat not found returns ErrChatNotFound (an owner_id mismatch also takes this
// branch, to avoid revealing "it exists but isn't yours").
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
) ([]entity.Message, error) {
	chatUUID, perr := pgstore.ParseUUID(chatID)
	if perr != nil {
		return nil, fmt.Errorf("parse chat id: %w", perr)
	}
	q := db.New(r.pool)
	rows, lerr := q.ListMessages(ctx, chatUUID)
	if lerr != nil {
		return nil, fmt.Errorf("list messages: %w", lerr)
	}
	out := make([]entity.Message, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainMessage(&rows[i]))
	}
	return out, nil
}

func toChatSummary(row *db.ListConversationsPageRow) ChatSummary {
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
