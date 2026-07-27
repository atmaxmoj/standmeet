// chats.go —— ChatRepo: chats (= conversations 表) + messages 表的 CRUD
// + admin 视角 list / transcript。AppendDialog 是一等 API (1 个 dialog
// = 2 条 message + bump，单事务原子)。底层 dbq query name 仍叫
// CreateConversation / GetConversation / AppendMessage / ListMessages
// (DB 表名没改)。
//
// 命名：domain Chat → DB conversations row 的映射在 toDomainChat。
// AppendMessage 仍存在但收成 unexported，dialog 写路径走 AppendDialog。

package conversation

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/conversation/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// ChatRepo —— conversations + messages 表的访问入口。
type ChatRepo struct {
	pool *pgstore.Pool
}

// NewChatRepo 构造 ChatRepo。
func NewChatRepo(pool *pgstore.Pool) *ChatRepo { return &ChatRepo{pool: pool} }

// CreateChatInput —— 创建 chat 入参。
type CreateChatInput struct {
	CodeID      *string
	MemberID    *string
	OwnerID     string
	Mode        string
	VisitorName string
	ClientIP    string // 访客来源 IP（chi.RealIP host，去 port）；空 = 未知
	DocKey      string // surface 标识：'' = 主聊天；否则 = 当时所在 doc 的 path
}

// CreateChat 写一行 chat。
func (r *ChatRepo) CreateChat(
	ctx context.Context, in *CreateChatInput,
) (Chat, error) {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return Chat{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	codeUUID, err := pgstore.ParseOptionalUUID(in.CodeID)
	if err != nil {
		return Chat{}, fmt.Errorf("parse code id: %w", err)
	}
	memberUUID, err := pgstore.ParseOptionalUUID(in.MemberID)
	if err != nil {
		return Chat{}, fmt.Errorf("parse member id: %w", err)
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
		return Chat{}, fmt.Errorf("create chat: %w", err)
	}
	return toDomainChat(&row), nil
}

// GetChat —— 拿一个 chat。不命中返 ErrChatNotFound。
func (r *ChatRepo) GetChat(
	ctx context.Context, ownerID, chatID string,
) (Chat, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return Chat{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	chatUUID, err := pgstore.ParseUUID(chatID)
	if err != nil {
		return Chat{}, fmt.Errorf("parse chat id: %w", err)
	}
	q := db.New(r.pool)
	row, err := q.GetConversation(ctx, db.GetConversationParams{
		ID: chatUUID, OwnerID: ownerUUID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Chat{}, ErrChatNotFound
		}
		return Chat{}, fmt.Errorf("get chat: %w", err)
	}
	return toDomainChat(&row), nil
}

// GetOpenChatByMember —— 「一个名字=一段续聊的会」:同名 member 的主对话就返它
// 续上;没有 → ErrChatNotFound (caller 新建)。对话不结束,同名永远续同一段。
func (r *ChatRepo) GetOpenChatByMember(
	ctx context.Context, memberID string,
) (Chat, error) {
	memberUUID, err := pgstore.ParseUUID(memberID)
	if err != nil {
		return Chat{}, fmt.Errorf("parse member id: %w", err)
	}
	row, qerr := db.New(r.pool).GetOpenConversationByMember(ctx, memberUUID)
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return Chat{}, ErrChatNotFound
		}
		return Chat{}, fmt.Errorf("get open chat by member: %w", qerr)
	}
	return toDomainChat(&row), nil
}

// AppendDialog / AppendVisitorOnly 实现 + splitCitations / runAppendDialogTx 拆到
// chats_dialog.go 守 350-line cap。row-level AppendMessage（老 SSE 路径）在 dialog 化后已删：
// 所有 message 现在必属一个 dialog（dialog_id NOT NULL），写路径只剩 AppendDialog（成对 Q-A）
// 与 AppendVisitorOnly（失败轮单-message dialog）。

// CountSessionsForMember —— quota check 用：member 至今起过多少 session。
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

// CountVisitorTurns —— turn quota check 用：当前 chat 里 visitor 发过几条。
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

func toDomainChat(c *db.Conversation) Chat {
	out := Chat{
		ID:          pgstore.FormatUUID(c.ID),
		OwnerID:     pgstore.FormatUUID(c.OwnerID),
		Mode:        ChatMode(c.Mode),
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

func toDomainMessage(m *db.Message) Message {
	return Message{
		ID:                   pgstore.FormatUUID(m.ID),
		ConversationID:       pgstore.FormatUUID(m.ConversationID),
		Role:                 m.Role,
		Body:                 m.Body,
		CitedWikiIDs:         pgstore.FormatUUIDList(m.CitedWikiIds),
		CitedWritingIDs:      pgstore.FormatUUIDList(m.CitedWritingIds),
		CitedOutputIDs:       pgstore.FormatUUIDList(m.CitedOutputIds),
		CitedSubjectivityIDs: pgstore.FormatUUIDList(m.CitedSubjectivityIds),
		ToolCalls:            m.ToolCalls,
		CreatedAt:            m.CreatedAt.Time,
	}
}

// ChatSummary / ChatWithMessages / ListByOwner / GetWithMessages / loadMessages
// 拆到 chats_admin.go 守 350-line cap。
