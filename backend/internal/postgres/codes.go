// codes.go —— access_codes + code_members + conversations + messages Repository。

package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres/dbq"
)

// CodeRepo —— access_codes CRUD。
type CodeRepo struct {
	pool *Pool
}

// NewCodeRepo 构造 CodeRepo。
func NewCodeRepo(pool *Pool) *CodeRepo { return &CodeRepo{pool: pool} }

// CreateCodeInput —— 创建 access code 入参。
type CreateCodeInput struct {
	ExpiresAt          *time.Time
	OwnerID            string
	Code               string
	Label              string
	Purpose            string
	IncludedTags       []string
	ExcludedTags       []string
	SuggestedQuestions []string
}

// Create 写一条 access_code。
func (r *CodeRepo) Create(ctx context.Context, in *CreateCodeInput) (domain.AccessCode, error) {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return domain.AccessCode{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	qs, jerr := json.Marshal(in.SuggestedQuestions)
	if jerr != nil {
		return domain.AccessCode{}, fmt.Errorf("marshal suggested questions: %w", jerr)
	}
	q := dbq.New(r.pool)
	row, err := q.CreateAccessCode(ctx, dbq.CreateAccessCodeParams{
		OwnerID:            ownerUUID,
		Code:               in.Code,
		Label:              in.Label,
		Purpose:            in.Purpose,
		IncludedTags:       in.IncludedTags,
		ExcludedTags:       in.ExcludedTags,
		SuggestedQuestions: qs,
		ExpiresAt:          ptrToTimestamptz(in.ExpiresAt),
	})
	if err != nil {
		return domain.AccessCode{}, fmt.Errorf("create access code: %w", err)
	}
	return toDomainCode(&row), nil
}

// GetByCode 拿 code（active only）；不命中返回 ErrCodeInvalid。
func (r *CodeRepo) GetByCode(ctx context.Context, code string) (domain.AccessCode, error) {
	q := dbq.New(r.pool)
	row, err := q.GetAccessCode(ctx, code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.AccessCode{}, domain.ErrCodeInvalid
		}
		return domain.AccessCode{}, fmt.Errorf("get access code: %w", err)
	}
	return toDomainCode(&row), nil
}

// ListByOwner 给 admin 列 codes。
func (r *CodeRepo) ListByOwner(ctx context.Context, ownerID string) ([]domain.AccessCode, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	q := dbq.New(r.pool)
	rows, err := q.ListAccessCodesByOwner(ctx, ownerUUID)
	if err != nil {
		return nil, fmt.Errorf("list access codes: %w", err)
	}
	out := make([]domain.AccessCode, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainCode(&rows[i]))
	}
	return out, nil
}

func toDomainCode(c *dbq.AccessCode) domain.AccessCode {
	out := domain.AccessCode{
		ID:           formatUUID(c.ID),
		OwnerID:      formatUUID(c.OwnerID),
		Code:         c.Code,
		Label:        c.Label,
		Purpose:      c.Purpose,
		IncludedTags: c.IncludedTags,
		ExcludedTags: c.ExcludedTags,
		Status:       c.Status,
		CreatedAt:    c.CreatedAt.Time,
	}
	if c.ExpiresAt.Valid {
		t := c.ExpiresAt.Time
		out.ExpiresAt = &t
	}
	if len(c.SuggestedQuestions) > 0 {
		if err := json.Unmarshal(c.SuggestedQuestions, &out.SuggestedQuestions); err != nil {
			_ = err
		}
	}
	return out
}

func ptrToTimestamptz(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{Valid: false}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
}

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
}

// AppendMessage 写 message + bump conversation。
func (r *ConversationRepo) AppendMessage(
	ctx context.Context, in *AppendMessageInput,
) (domain.Message, error) {
	convUUID, err := parseUUID(in.ConversationID)
	if err != nil {
		return domain.Message{}, fmt.Errorf("parse conv id: %w", err)
	}
	citedUUIDs, err := parseUUIDArray(in.CitedWikiIDs)
	if err != nil {
		return domain.Message{}, fmt.Errorf("parse cited wiki ids: %w", err)
	}
	q := dbq.New(r.pool)
	row, err := q.AppendMessage(ctx, dbq.AppendMessageParams{
		ConversationID: convUUID,
		Role:           in.Role,
		Body:           in.Body,
		CitedWikiIds:   citedUUIDs,
	})
	if err != nil {
		return domain.Message{}, fmt.Errorf("append message: %w", err)
	}
	if berr := q.BumpConversation(ctx, dbq.BumpConversationParams{
		ID: convUUID, HitPrivate: false,
	}); berr != nil {
		return domain.Message{}, fmt.Errorf("bump conversation: %w", berr)
	}
	return toDomainMessage(&row), nil
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
		HitPrivate:   c.HitPrivate,
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
		CreatedAt:      m.CreatedAt.Time,
	}
}
