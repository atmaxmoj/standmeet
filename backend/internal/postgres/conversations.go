// conversations.go —— ConversationRepo 全部 method（CRUD + admin 视角 list /
// transcript）。从 codes.go 拆出来是 max-lines 350 限制。

package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres/dbq"
)

// ConversationRepo —— conversations + messages。
type ConversationRepo struct {
	pool *Pool
}

// NewConversationRepo 构造 ConversationRepo。
func NewConversationRepo(pool *Pool) *ConversationRepo { return &ConversationRepo{pool: pool} }

// CreateConvInput —— 创建 conversation 入参。
type CreateConvInput struct {
	CodeID        *string
	MemberID      *string
	BYOAIProvider *string
	OwnerID       string
	Tier          string
	VisitorName   string
}

// CreateConversation 写一行 conversation。
func (r *ConversationRepo) CreateConversation(
	ctx context.Context, in *CreateConvInput,
) (domain.Conversation, error) {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return domain.Conversation{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	codeUUID, err := parseOptionalUUID(in.CodeID)
	if err != nil {
		return domain.Conversation{}, fmt.Errorf("parse code id: %w", err)
	}
	memberUUID, err := parseOptionalUUID(in.MemberID)
	if err != nil {
		return domain.Conversation{}, fmt.Errorf("parse member id: %w", err)
	}
	q := dbq.New(r.pool)
	row, err := q.CreateConversation(ctx, dbq.CreateConversationParams{
		OwnerID:       ownerUUID,
		Tier:          in.Tier,
		CodeID:        codeUUID,
		MemberID:      memberUUID,
		VisitorName:   in.VisitorName,
		ByoaiProvider: in.BYOAIProvider,
	})
	if err != nil {
		return domain.Conversation{}, fmt.Errorf("create conversation: %w", err)
	}
	return toDomainConv(&row), nil
}

// GetConversation —— 拿 conversation。
func (r *ConversationRepo) GetConversation(
	ctx context.Context, ownerID, convID string,
) (domain.Conversation, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return domain.Conversation{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	convUUID, err := parseUUID(convID)
	if err != nil {
		return domain.Conversation{}, fmt.Errorf("parse conv id: %w", err)
	}
	q := dbq.New(r.pool)
	row, err := q.GetConversation(ctx, dbq.GetConversationParams{ID: convUUID, OwnerID: ownerUUID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Conversation{}, domain.ErrConversationNotFound
		}
		return domain.Conversation{}, fmt.Errorf("get conversation: %w", err)
	}
	return toDomainConv(&row), nil
}

// AppendMessageInput —— 写一条 message 入参。
type AppendMessageInput struct {
	ConversationID string
	Role           string
	Body           string
	CitedWikiIDs   []string
	CitedOutputIDs []string
}

// AppendMessage 写 message + bump conversation。
func (r *ConversationRepo) AppendMessage(
	ctx context.Context, in *AppendMessageInput,
) (domain.Message, error) {
	params, err := buildAppendMessageParams(in)
	if err != nil {
		return domain.Message{}, err
	}
	q := dbq.New(r.pool)
	row, err := q.AppendMessage(ctx, params)
	if err != nil {
		return domain.Message{}, fmt.Errorf("append message: %w", err)
	}
	if berr := q.BumpConversation(ctx, params.ConversationID); berr != nil {
		return domain.Message{}, fmt.Errorf("bump conversation: %w", berr)
	}
	return toDomainMessage(&row), nil
}

func buildAppendMessageParams(in *AppendMessageInput) (dbq.AppendMessageParams, error) {
	convUUID, err := parseUUID(in.ConversationID)
	if err != nil {
		return dbq.AppendMessageParams{}, fmt.Errorf("parse conv id: %w", err)
	}
	citedWiki, err := parseUUIDArray(in.CitedWikiIDs)
	if err != nil {
		return dbq.AppendMessageParams{}, fmt.Errorf("parse cited wiki ids: %w", err)
	}
	citedOutput, err := parseUUIDArray(in.CitedOutputIDs)
	if err != nil {
		return dbq.AppendMessageParams{}, fmt.Errorf("parse cited output ids: %w", err)
	}
	// BumpConversation 紧跟 AppendMessage；先把 convUUID 暴露出来给 caller。
	return dbq.AppendMessageParams{
		ConversationID: convUUID,
		Role:           in.Role,
		Body:           in.Body,
		CitedWikiIds:   citedWiki,
		CitedOutputIds: citedOutput,
	}, nil
}

// CountSessionsForMember —— quota check 用：member 至今起过多少 session。
func (r *ConversationRepo) CountSessionsForMember(
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

// CountVisitorTurns —— turn quota check 用：当前 conversation 里 visitor 发过几条。
func (r *ConversationRepo) CountVisitorTurns(
	ctx context.Context, convID string,
) (int32, error) {
	convUUID, err := parseUUID(convID)
	if err != nil {
		return 0, fmt.Errorf("parse conv id: %w", err)
	}
	q := dbq.New(r.pool)
	n, qerr := q.CountVisitorTurnsInConversation(ctx, convUUID)
	if qerr != nil {
		return 0, fmt.Errorf("count visitor turns: %w", qerr)
	}
	return n, nil
}

func toDomainConv(c *dbq.Conversation) domain.Conversation {
	out := domain.Conversation{
		ID:           formatUUID(c.ID),
		OwnerID:      formatUUID(c.OwnerID),
		Tier:         c.Tier,
		VisitorName:  c.VisitorName,
		StartedAt:    c.StartedAt.Time,
		LastAt:       c.LastAt.Time,
		MessageCount: c.MessageCount,
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
		CodeLabel:    row.CodeLabel,
		CodeValue:    row.CodeValue,
	}
	if row.CodeID.Valid {
		s := formatUUID(row.CodeID)
		out.CodeID = &s
	}
	return out
}
