// chats_member.go — member-level read side: across a member's multiple conversation
// threads. member-wide turn counting (quota), finding a conversation by doc_key
// (floating-window find-or-create), and pulling other conversations' messages for
// "cross-talk" injection. Split out of chats.go to hold the max-lines 350 cap.

package repo

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/conversation/db"
	"github.com/atmaxmoj/standmeet/internal/conversation/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// ConversationMemberID —— the member that owns a conversation (within owner scope). Used by the
// booker visitor-cancel isolation gate (host-side resolver: bookings in booker's capstore carry
// only conversation_id). Unknown conversation → ("", nil): an empty member id the caller treats as
// "not this member's" (must not leak existence). Only a real DB error propagates.
func (r *ChatRepo) ConversationMemberID(
	ctx context.Context, ownerID, conversationID string,
) (string, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return "", fmt.Errorf("parse owner id: %w", err)
	}
	convUUID, err := pgstore.ParseUUID(conversationID)
	if err != nil {
		return "", fmt.Errorf("parse conversation id: %w", err)
	}
	conv, qerr := db.New(r.pool).GetConversation(ctx,
		db.GetConversationParams{ID: convUUID, OwnerID: ownerUUID})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			// unknown conversation = not-found (empty member), not a failure to surface.
			return "", nil
		}
		return "", fmt.Errorf("conversation member: %w", qerr)
	}
	return pgstore.FormatUUID(conv.MemberID), nil
}

// CountVisitorTurnsForMember — total visitor messages across all of this member's
// conversations (member-level quota).
func (r *ChatRepo) CountVisitorTurnsForMember(
	ctx context.Context, memberID string,
) (int32, error) {
	memberUUID, err := pgstore.ParseUUID(memberID)
	if err != nil {
		return 0, fmt.Errorf("parse member id: %w", err)
	}
	n, qerr := db.New(r.pool).CountVisitorTurnsForMember(ctx, memberUUID)
	if qerr != nil {
		return 0, fmt.Errorf("count member turns: %w", qerr)
	}
	return n, nil
}

// GetOpenChatByMemberAndDoc — this member's unfinished conversation on a given
// surface (doc_key); none found returns ErrChatNotFound (caller creates new).
func (r *ChatRepo) GetOpenChatByMemberAndDoc(
	ctx context.Context, memberID, docKey string,
) (entity.Chat, error) {
	memberUUID, err := pgstore.ParseUUID(memberID)
	if err != nil {
		return entity.Chat{}, fmt.Errorf("parse member id: %w", err)
	}
	row, qerr := db.New(r.pool).GetOpenConversationByMemberAndDoc(ctx,
		db.GetOpenConversationByMemberAndDocParams{MemberID: memberUUID, DocKey: docKey})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return entity.Chat{}, entity.ErrChatNotFound
		}
		return entity.Chat{}, fmt.Errorf("get open chat by member+doc: %w", qerr)
	}
	return toDomainChat(&row), nil
}

// MemberOtherMessage — one message from this member's other conversations (for the
// "cross-talk" digest).
type MemberOtherMessage struct {
	CreatedAt time.Time
	DocKey    string
	Role      string
	Body      string
}

// ListMemberOtherMessages — this member's messages from **other** conversations
// (excludeConvID excluded), in chronological order. Caller truncates / summarizes
// into an instruction block itself.
func (r *ChatRepo) ListMemberOtherMessages(
	ctx context.Context, memberID, excludeConvID string,
) ([]MemberOtherMessage, error) {
	memberUUID, err := pgstore.ParseUUID(memberID)
	if err != nil {
		return nil, fmt.Errorf("parse member id: %w", err)
	}
	exclUUID, eerr := pgstore.ParseUUID(excludeConvID)
	if eerr != nil {
		return nil, fmt.Errorf("parse exclude conv id: %w", eerr)
	}
	rows, qerr := db.New(r.pool).ListMemberOtherConversationMessages(ctx,
		db.ListMemberOtherConversationMessagesParams{MemberID: memberUUID, ID: exclUUID})
	if qerr != nil {
		return nil, fmt.Errorf("list member other messages: %w", qerr)
	}
	out := make([]MemberOtherMessage, 0, len(rows))
	for i := range rows {
		out = append(out, MemberOtherMessage{
			DocKey:    rows[i].DocKey,
			Role:      rows[i].Role,
			Body:      rows[i].Body,
			CreatedAt: rows[i].CreatedAt.Time,
		})
	}
	return out, nil
}
