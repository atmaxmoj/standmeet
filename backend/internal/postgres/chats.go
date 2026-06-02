// chats.go —— ChatRepo: chats (= conversations 表) + messages 表的 CRUD
// + admin 视角 list / transcript。AppendDialog 是一等 API (1 个 dialog
// = 2 条 message + bump，单事务原子)。底层 dbq query name 仍叫
// CreateConversation / GetConversation / AppendMessage / ListMessages
// (DB 表名没改)。
//
// 命名：domain Chat → DB conversations row 的映射在 toDomainChat。
// AppendMessage 仍存在但收成 unexported，dialog 写路径走 AppendDialog。

package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// ChatRepo —— conversations + messages 表的访问入口。
type ChatRepo struct {
	pool *Pool
}

// NewChatRepo 构造 ChatRepo。
func NewChatRepo(pool *Pool) *ChatRepo { return &ChatRepo{pool: pool} }

// CreateChatInput —— 创建 chat 入参。
type CreateChatInput struct {
	CodeID        *string
	MemberID      *string
	BYOAIProvider *string
	OwnerID       string
	Mode          string
	VisitorName   string
}

// CreateChat 写一行 chat。
func (r *ChatRepo) CreateChat(
	ctx context.Context, in *CreateChatInput,
) (domain.Chat, error) {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return domain.Chat{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	codeUUID, err := parseOptionalUUID(in.CodeID)
	if err != nil {
		return domain.Chat{}, fmt.Errorf("parse code id: %w", err)
	}
	memberUUID, err := parseOptionalUUID(in.MemberID)
	if err != nil {
		return domain.Chat{}, fmt.Errorf("parse member id: %w", err)
	}
	q := dbq.New(r.pool)
	row, err := q.CreateConversation(ctx, dbq.CreateConversationParams{
		OwnerID:       ownerUUID,
		Mode:          in.Mode,
		CodeID:        codeUUID,
		MemberID:      memberUUID,
		VisitorName:   in.VisitorName,
		ByoaiProvider: in.BYOAIProvider,
	})
	if err != nil {
		return domain.Chat{}, fmt.Errorf("create chat: %w", err)
	}
	return toDomainChat(&row), nil
}

// GetChat —— 拿一个 chat。不命中返 domain.ErrChatNotFound。
func (r *ChatRepo) GetChat(
	ctx context.Context, ownerID, chatID string,
) (domain.Chat, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return domain.Chat{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	chatUUID, err := parseUUID(chatID)
	if err != nil {
		return domain.Chat{}, fmt.Errorf("parse chat id: %w", err)
	}
	q := dbq.New(r.pool)
	row, err := q.GetConversation(ctx, dbq.GetConversationParams{
		ID: chatUUID, OwnerID: ownerUUID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Chat{}, domain.ErrChatNotFound
		}
		return domain.Chat{}, fmt.Errorf("get chat: %w", err)
	}
	return toDomainChat(&row), nil
}

// AppendMessageInput —— 写一条 message 入参 (legacy /messages SSE 路径 +
// visitor_chat retriever 仍在用；新 dialog 写路径走 AppendDialog)。
type AppendMessageInput struct {
	ConversationID string
	Role           string
	Body           string
	CitedWikiIDs   []string
	CitedOutputIDs []string
}

// AppendMessage —— 写 message + bump conversation。**这是 row-level API**。
// 一轮完整 Q-A 持久化用 AppendDialog (单事务 + invariant)；这里保留是给
// 老 /messages SSE 路径用，prod 不再走，G-6 一并删。
func (r *ChatRepo) AppendMessage(
	ctx context.Context, in *AppendMessageInput,
) (domain.Message, error) {
	params, err := buildAppendMessageParams(in)
	if err != nil {
		return domain.Message{}, err
	}
	q := dbq.New(r.pool)
	row, qerr := q.AppendMessage(ctx, params)
	if qerr != nil {
		return domain.Message{}, fmt.Errorf("append message: %w", qerr)
	}
	if berr := q.BumpConversation(ctx, params.ConversationID); berr != nil {
		return domain.Message{}, fmt.Errorf("bump chat: %w", berr)
	}
	return toDomainMessage(&row), nil
}

func buildAppendMessageParams(in *AppendMessageInput) (dbq.AppendMessageParams, error) {
	chatUUID, err := parseUUID(in.ConversationID)
	if err != nil {
		return dbq.AppendMessageParams{}, fmt.Errorf("parse chat id: %w", err)
	}
	citedWiki, err := parseUUIDArray(in.CitedWikiIDs)
	if err != nil {
		return dbq.AppendMessageParams{}, fmt.Errorf("parse cited wiki ids: %w", err)
	}
	citedOutput, err := parseUUIDArray(in.CitedOutputIDs)
	if err != nil {
		return dbq.AppendMessageParams{}, fmt.Errorf("parse cited output ids: %w", err)
	}
	return dbq.AppendMessageParams{
		ConversationID: chatUUID, Role: in.Role, Body: in.Body,
		CitedWikiIds: citedWiki, CitedOutputIds: citedOutput,
	}, nil
}

// AppendDialog 实现 + splitCitations / runAppendDialogTx 拆到
// chats_dialog.go 守 350-line cap。这里只暴露 row-level AppendMessage 给
// 老 SSE 路径。

// CountSessionsForMember —— quota check 用：member 至今起过多少 session。
func (r *ChatRepo) CountSessionsForMember(
	ctx context.Context, memberID string,
) (int32, error) {
	memberUUID, err := parseUUID(memberID)
	if err != nil {
		return 0, fmt.Errorf("parse member id: %w", err)
	}
	q := dbq.New(r.pool)
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
	chatUUID, err := parseUUID(chatID)
	if err != nil {
		return 0, fmt.Errorf("parse chat id: %w", err)
	}
	q := dbq.New(r.pool)
	n, qerr := q.CountVisitorTurnsInConversation(ctx, chatUUID)
	if qerr != nil {
		return 0, fmt.Errorf("count visitor turns: %w", qerr)
	}
	return n, nil
}

// MarkEnded —— /summary 路径写：summary + ended_at；已 ended 返
// ErrChatEnded 让 caller 翻 409 友好错误。
func (r *ChatRepo) MarkEnded(
	ctx context.Context, chatID, summaryMD string,
) (domain.Chat, error) {
	chatUUID, perr := parseUUID(chatID)
	if perr != nil {
		return domain.Chat{}, fmt.Errorf("parse chat id: %w", perr)
	}
	row, err := dbq.New(r.pool).MarkConversationEnded(ctx, dbq.MarkConversationEndedParams{
		ID: chatUUID, SummaryMd: summaryMD,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Chat{}, domain.ErrChatEnded
		}
		return domain.Chat{}, fmt.Errorf("mark chat ended: %w", err)
	}
	return toDomainChat(&row), nil
}

func toDomainChat(c *dbq.Conversation) domain.Chat {
	out := domain.Chat{
		ID:           formatUUID(c.ID),
		OwnerID:      formatUUID(c.OwnerID),
		Mode:         domain.ChatMode(c.Mode),
		VisitorName:  c.VisitorName,
		StartedAt:    c.StartedAt.Time,
		LastAt:       c.LastAt.Time,
		MessageCount: c.MessageCount,
		SummaryMD:    c.SummaryMd,
	}
	if c.CodeID.Valid {
		s := formatUUID(c.CodeID)
		out.CodeID = &s
	}
	if c.MemberID.Valid {
		s := formatUUID(c.MemberID)
		out.MemberID = &s
	}
	if c.ByoaiProvider != nil {
		out.BYOAIProvider = c.ByoaiProvider
	}
	if c.EndedAt.Valid {
		t := c.EndedAt.Time
		out.EndedAt = &t
	}
	return out
}

func toDomainMessage(m *dbq.Message) domain.Message {
	return domain.Message{
		ID:             formatUUID(m.ID),
		ConversationID: formatUUID(m.ConversationID),
		Role:           m.Role,
		Body:           m.Body,
		CitedWikiIDs:   formatUUIDList(m.CitedWikiIds),
		CitedOutputIDs: formatUUIDList(m.CitedOutputIds),
		CreatedAt:      m.CreatedAt.Time,
	}
}

// ChatSummary / ChatWithMessages / ListByOwner / GetWithMessages / loadMessages
// 拆到 chats_admin.go 守 350-line cap。
