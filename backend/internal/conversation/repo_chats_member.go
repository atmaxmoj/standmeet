// chats_member.go —— member 级读侧:跨该 member 的多段对话。member-wide turn
// 计数(配额)、按 doc_key 找对话(浮窗 find-or-create)、拉其他对话消息给「互通」
// 注入。从 chats.go 拆出来守 max-lines 350 cap。

package conversation

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/pgstore"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
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
	conv, qerr := dbq.New(r.pool).GetConversation(ctx,
		dbq.GetConversationParams{ID: convUUID, OwnerID: ownerUUID})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			// unknown conversation = not-found (empty member), not a failure to surface.
			return "", nil
		}
		return "", fmt.Errorf("conversation member: %w", qerr)
	}
	return pgstore.FormatUUID(conv.MemberID), nil
}

// CountVisitorTurnsForMember —— 该 member 名下全部对话的访客发言合计(member 级配额)。
func (r *ChatRepo) CountVisitorTurnsForMember(
	ctx context.Context, memberID string,
) (int32, error) {
	memberUUID, err := pgstore.ParseUUID(memberID)
	if err != nil {
		return 0, fmt.Errorf("parse member id: %w", err)
	}
	n, qerr := dbq.New(r.pool).CountVisitorTurnsForMember(ctx, memberUUID)
	if qerr != nil {
		return 0, fmt.Errorf("count member turns: %w", qerr)
	}
	return n, nil
}

// GetOpenChatByMemberAndDoc —— 该 member 在某 surface(doc_key)未结束的那段对话;
// 没有返 ErrChatNotFound(caller 新建)。
func (r *ChatRepo) GetOpenChatByMemberAndDoc(
	ctx context.Context, memberID, docKey string,
) (Chat, error) {
	memberUUID, err := pgstore.ParseUUID(memberID)
	if err != nil {
		return Chat{}, fmt.Errorf("parse member id: %w", err)
	}
	row, qerr := dbq.New(r.pool).GetOpenConversationByMemberAndDoc(ctx,
		dbq.GetOpenConversationByMemberAndDocParams{MemberID: memberUUID, DocKey: docKey})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return Chat{}, ErrChatNotFound
		}
		return Chat{}, fmt.Errorf("get open chat by member+doc: %w", qerr)
	}
	return toDomainChat(&row), nil
}

// MemberOtherMessage —— 该 member 其他对话的一条消息(给「互通」digest 用)。
type MemberOtherMessage struct {
	CreatedAt time.Time
	DocKey    string
	Role      string
	Body      string
}

// ListMemberOtherMessages —— 该 member **其他**对话(排除 excludeConvID)的消息,
// 时间正序。caller 自己截断 / 汇总成 instruction 块。
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
	rows, qerr := dbq.New(r.pool).ListMemberOtherConversationMessages(ctx,
		dbq.ListMemberOtherConversationMessagesParams{MemberID: memberUUID, ID: exclUUID})
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
