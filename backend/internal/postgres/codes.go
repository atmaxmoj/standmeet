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
	ExpiresAt            *time.Time
	MaxSessionsPerMember *int32
	MaxTurnsPerSession   *int32
	OwnerID              string
	Code                 string
	Label                string
	Purpose              string
	IncludedTags         []string
	ExcludedTags         []string
	SuggestedQuestions   []string
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
		OwnerID:              ownerUUID,
		Code:                 in.Code,
		Label:                in.Label,
		Purpose:              in.Purpose,
		IncludedTags:         in.IncludedTags,
		ExcludedTags:         in.ExcludedTags,
		SuggestedQuestions:   qs,
		ExpiresAt:            ptrToTimestamptz(in.ExpiresAt),
		MaxSessionsPerMember: in.MaxSessionsPerMember,
		MaxTurnsPerSession:   in.MaxTurnsPerSession,
	})
	if err != nil {
		return domain.AccessCode{}, fmt.Errorf("create access code: %w", err)
	}
	return toDomainCode(&row), nil
}

// Revoke 把 code.status 改成 'revoked'；GetAccessCode（只查 active）从此跳过它。
func (r *CodeRepo) Revoke(ctx context.Context, ownerID, codeID string) error {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	codeUUID, err := parseUUID(codeID)
	if err != nil {
		return fmt.Errorf("parse code id: %w", err)
	}
	q := dbq.New(r.pool)
	if rerr := q.RevokeAccessCode(ctx, dbq.RevokeAccessCodeParams{
		ID: codeUUID, OwnerID: ownerUUID,
	}); rerr != nil {
		return fmt.Errorf("revoke access code: %w", rerr)
	}
	return nil
}

// GetOrCreateMember —— 按 (code_id, display_name) upsert code_member。
// IdentityPicker 用：访客在 gate 输入名字 → 这里拿/建一个 member row →
// session 携带 member_id 让后续 quota check 命中正确的人。
func (r *CodeRepo) GetOrCreateMember(
	ctx context.Context, codeID, displayName string,
) (domain.CodeMember, error) {
	codeUUID, err := parseUUID(codeID)
	if err != nil {
		return domain.CodeMember{}, fmt.Errorf("parse code id: %w", err)
	}
	q := dbq.New(r.pool)
	row, qerr := q.GetOrCreateCodeMember(ctx, dbq.GetOrCreateCodeMemberParams{
		CodeID: codeUUID, DisplayName: displayName, IsAnonymous: displayName == "",
	})
	if qerr != nil {
		return domain.CodeMember{}, fmt.Errorf("upsert code member: %w", qerr)
	}
	return toDomainMember(&row), nil
}

// ListMembers —— admin 看 code 下所有 member（含 revoked，UI 自己分组）。
func (r *CodeRepo) ListMembers(ctx context.Context, codeID string) ([]domain.CodeMember, error) {
	codeUUID, err := parseUUID(codeID)
	if err != nil {
		return nil, fmt.Errorf("parse code id: %w", err)
	}
	q := dbq.New(r.pool)
	rows, qerr := q.ListCodeMembers(ctx, codeUUID)
	if qerr != nil {
		return nil, fmt.Errorf("list code members: %w", qerr)
	}
	out := make([]domain.CodeMember, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainMember(&rows[i]))
	}
	return out, nil
}

func toDomainMember(m *dbq.CodeMember) domain.CodeMember {
	out := domain.CodeMember{
		ID:          formatUUID(m.ID),
		CodeID:      formatUUID(m.CodeID),
		DisplayName: m.DisplayName,
		IsAnonymous: m.IsAnonymous,
	}
	if m.Email != nil {
		out.Email = *m.Email
	}
	if m.LastSeenAt.Valid {
		out.LastSeenAt = m.LastSeenAt.Time
	}
	return out
}

// UpdateQuotas 改某 code 的配额；返回新行（让 admin UI 直接刷）。
func (r *CodeRepo) UpdateQuotas(
	ctx context.Context, ownerID, codeID string, maxSessions, maxTurns *int32,
) (domain.AccessCode, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return domain.AccessCode{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	codeUUID, err := parseUUID(codeID)
	if err != nil {
		return domain.AccessCode{}, fmt.Errorf("parse code id: %w", err)
	}
	q := dbq.New(r.pool)
	row, qerr := q.UpdateAccessCodeQuotas(ctx, dbq.UpdateAccessCodeQuotasParams{
		ID: codeUUID, OwnerID: ownerUUID,
		MaxSessionsPerMember: maxSessions, MaxTurnsPerSession: maxTurns,
	})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return domain.AccessCode{}, domain.ErrCodeInvalid
		}
		return domain.AccessCode{}, fmt.Errorf("update access code quotas: %w", qerr)
	}
	return toDomainCode(&row), nil
}

// GetByID 拿 code（按 UUID，含 revoked）；不命中返 ErrCodeInvalid。turn quota
// check 用：旧 conversation 还要查到背后 code 的 max_turns。
func (r *CodeRepo) GetByID(ctx context.Context, codeID string) (domain.AccessCode, error) {
	codeUUID, perr := parseUUID(codeID)
	if perr != nil {
		return domain.AccessCode{}, fmt.Errorf("parse code id: %w", perr)
	}
	q := dbq.New(r.pool)
	row, err := q.GetAccessCodeByID(ctx, codeUUID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.AccessCode{}, domain.ErrCodeInvalid
		}
		return domain.AccessCode{}, fmt.Errorf("get access code by id: %w", err)
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
		ID:                   formatUUID(c.ID),
		OwnerID:              formatUUID(c.OwnerID),
		Code:                 c.Code,
		Label:                c.Label,
		Purpose:              c.Purpose,
		IncludedTags:         c.IncludedTags,
		ExcludedTags:         c.ExcludedTags,
		Status:               c.Status,
		CreatedAt:            c.CreatedAt.Time,
		MaxSessionsPerMember: c.MaxSessionsPerMember,
		MaxTurnsPerSession:   c.MaxTurnsPerSession,
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
