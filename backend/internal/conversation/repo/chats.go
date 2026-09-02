// chats.go — ChatRepo: CRUD for the chats (= conversations table) + messages table,
// plus admin-view list / transcript. AppendDialog is a first-class API (1 dialog =
// 2 messages + bump, atomic in one transaction). The underlying dbq query names are
// still CreateConversation / GetConversation / AppendMessage / ListMessages (the DB
// table names haven't changed).
//
// Naming: the domain Chat ← DB conversations row mapping lives in toDomainChat.
// AppendMessage still exists but is now unexported; the dialog write path goes
// through AppendDialog.

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/conversation/db"
	"github.com/atmaxmoj/standmeet/internal/conversation/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// ChatRepo — access entry point for the conversations + messages tables.
type ChatRepo struct {
	pool *pgstore.Pool
}

// NewChatRepo constructs a ChatRepo.
func NewChatRepo(pool *pgstore.Pool) *ChatRepo { return &ChatRepo{pool: pool} }

// CreateChatInput — input for creating a chat.
type CreateChatInput struct {
	CodeID      *string
	MemberID    *string
	OwnerID     string
	Mode        string
	VisitorName string
	ClientIP    string // Visitor source IP (chi.RealIP host, port stripped); empty = unknown
	DocKey      string // surface identifier: '' = main chat; otherwise the doc path at the time
}

// CreateChat writes one chat row.
func (r *ChatRepo) CreateChat(
	ctx context.Context, in *CreateChatInput,
) (entity.Chat, error) {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return entity.Chat{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	codeUUID, err := pgstore.ParseOptionalUUID(in.CodeID)
	if err != nil {
		return entity.Chat{}, fmt.Errorf("parse code id: %w", err)
	}
	memberUUID, err := pgstore.ParseOptionalUUID(in.MemberID)
	if err != nil {
		return entity.Chat{}, fmt.Errorf("parse member id: %w", err)
	}
	q := db.New(r.pool)
	row, err := q.CreateConversation(ctx, db.CreateConversationParams{
		OwnerID:     ownerUUID,
		Mode:        in.Mode,
		CodeID:      codeUUID,
		MemberID:    memberUUID,
		VisitorName: in.VisitorName,
		ClientIp:    in.ClientIP,
		DocKey:      in.DocKey,
	})
	if err != nil {
		return entity.Chat{}, fmt.Errorf("create chat: %w", err)
	}
	return toDomainChat(&row), nil
}

// GetChat — fetches one chat. Not found returns ErrChatNotFound.
func (r *ChatRepo) GetChat(
	ctx context.Context, ownerID, chatID string,
) (entity.Chat, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return entity.Chat{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	chatUUID, err := pgstore.ParseUUID(chatID)
	if err != nil {
		return entity.Chat{}, fmt.Errorf("parse chat id: %w", err)
	}
	q := db.New(r.pool)
	row, err := q.GetConversation(ctx, db.GetConversationParams{
		ID: chatUUID, OwnerID: ownerUUID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Chat{}, entity.ErrChatNotFound
		}
		return entity.Chat{}, fmt.Errorf("get chat: %w", err)
	}
	return toDomainChat(&row), nil
}

// GetOpenChatByMember — "one name = one ongoing conversation": returns the
// same-named member's main conversation to continue it; none found →
// ErrChatNotFound (caller creates a new one). A conversation never ends, so the
// same name always continues the same thread.
func (r *ChatRepo) GetOpenChatByMember(
	ctx context.Context, memberID string,
) (entity.Chat, error) {
	memberUUID, err := pgstore.ParseUUID(memberID)
	if err != nil {
		return entity.Chat{}, fmt.Errorf("parse member id: %w", err)
	}
	row, qerr := db.New(r.pool).GetOpenConversationByMember(ctx, memberUUID)
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return entity.Chat{}, entity.ErrChatNotFound
		}
		return entity.Chat{}, fmt.Errorf("get open chat by member: %w", qerr)
	}
	return toDomainChat(&row), nil
}

// AppendDialog / AppendVisitorOnly implementation + splitCitations / runAppendDialogTx are
// split out to chats_dialog.go to hold the 350-line cap. The old row-level AppendMessage
// (SSE path) was deleted after dialog-ization: every message must now belong to a dialog
// (dialog_id NOT NULL), so the write path is only AppendDialog (paired Q-A) and
// AppendVisitorOnly (single-message dialog for a failed turn).

// CountSessionsForMember — for quota checks: how many sessions a member has started to date.
func (r *ChatRepo) CountSessionsForMember(
	ctx context.Context, memberID string,
) (int32, error) {
	memberUUID, err := pgstore.ParseUUID(memberID)
	if err != nil {
		return 0, fmt.Errorf("parse member id: %w", err)
	}
	q := db.New(r.pool)
	n, qerr := q.CountSessionsForMember(ctx, memberUUID)
	if qerr != nil {
		return 0, fmt.Errorf("count sessions for member: %w", qerr)
	}
	return n, nil
}

// CountVisitorTurns — for turn quota checks: how many visitor messages in the current chat.
func (r *ChatRepo) CountVisitorTurns(
	ctx context.Context, chatID string,
) (int32, error) {
	chatUUID, err := pgstore.ParseUUID(chatID)
	if err != nil {
		return 0, fmt.Errorf("parse chat id: %w", err)
	}
	q := db.New(r.pool)
	n, qerr := q.CountVisitorTurnsInConversation(ctx, chatUUID)
	if qerr != nil {
		return 0, fmt.Errorf("count visitor turns: %w", qerr)
	}
	return n, nil
}

func toDomainChat(c *db.Conversation) entity.Chat {
	out := entity.Chat{
		ID:          pgstore.FormatUUID(c.ID),
		OwnerID:     pgstore.FormatUUID(c.OwnerID),
		Mode:        entity.ChatMode(c.Mode),
		VisitorName: c.VisitorName,
		StartedAt:   c.StartedAt.Time,
		LastAt:      c.LastAt.Time,
	}
	if c.CodeID.Valid {
		s := pgstore.FormatUUID(c.CodeID)
		out.CodeID = &s
	}
	if c.MemberID.Valid {
		s := pgstore.FormatUUID(c.MemberID)
		out.MemberID = &s
	}
	return out
}

func toDomainMessage(m *db.Message) entity.Message {
	return entity.Message{
		ID:                      pgstore.FormatUUID(m.ID),
		ConversationID:          pgstore.FormatUUID(m.ConversationID),
		Role:                    m.Role,
		Body:                    m.Body,
		CitedWikiIDs:            pgstore.FormatUUIDList(m.CitedWikiIds),
		CitedWritingIDs:         pgstore.FormatUUIDList(m.CitedWritingIds),
		CitedOutputIDs:          pgstore.FormatUUIDList(m.CitedOutputIds),
		CitedSubjectivityIDs:    pgstore.FormatUUIDList(m.CitedSubjectivityIds),
		GroundedSubjectivityIDs: pgstore.FormatUUIDList(m.GroundedSubjectivityIds),
		ToolCalls:               m.ToolCalls,
		CreatedAt:               m.CreatedAt.Time,
	}
}

// ChatSummary / ChatWithMessages / ListByOwner / GetWithMessages / loadMessages are split
// out to chats_admin.go to hold the 350-line cap.
