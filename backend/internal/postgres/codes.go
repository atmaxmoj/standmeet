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

// errParseCodeIDPrefix —— "parse code id: %w" 字面在本文件 6+ 处出现，提常量。
const errParseCodeIDPrefix = "parse code id: %w"

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
	MaxBookings          *int32
	OwnerID              string
	Code                 string
	Label                string
	Purpose              string
	CorpusPermissions    []domain.PathPermission
	SuggestedQuestions   []string
	GrantedSkills        []string
}

// Create 写一条 access_code。
func (r *CodeRepo) Create(ctx context.Context, in *CreateCodeInput) (domain.AccessCode, error) {
	params, perr := buildCreateCodeParams(in)
	if perr != nil {
		return domain.AccessCode{}, perr
	}
	row, err := dbq.New(r.pool).CreateAccessCode(ctx, *params)
	if err != nil {
		return domain.AccessCode{}, fmt.Errorf("create access code: %w", err)
	}
	return toDomainCode(&row), nil
}

func buildCreateCodeParams(in *CreateCodeInput) (*dbq.CreateAccessCodeParams, error) {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	qs, jerr := json.Marshal(in.SuggestedQuestions)
	if jerr != nil {
		return nil, fmt.Errorf("marshal suggested questions: %w", jerr)
	}
	perms, perr := json.Marshal(in.CorpusPermissions)
	if perr != nil {
		return nil, fmt.Errorf("marshal corpus permissions: %w", perr)
	}
	grants := in.GrantedSkills
	if grants == nil {
		grants = []string{}
	}
	return &dbq.CreateAccessCodeParams{
		OwnerID:              ownerUUID,
		Code:                 in.Code,
		Label:                in.Label,
		Purpose:              in.Purpose,
		CorpusPermissions:    perms,
		SuggestedQuestions:   qs,
		ExpiresAt:            ptrToTimestamptz(in.ExpiresAt),
		MaxSessionsPerMember: in.MaxSessionsPerMember,
		MaxTurnsPerSession:   in.MaxTurnsPerSession,
		GrantedSkills:        grants,
		MaxBookings:          in.MaxBookings,
	}, nil
}

// UpdatePermissions —— 改某 code 的 corpus_permissions。
func (r *CodeRepo) UpdatePermissions(
	ctx context.Context, ownerID, codeID string, perms []domain.PathPermission,
) (domain.AccessCode, error) {
	params, err := buildUpdatePermissionsParams(ownerID, codeID, perms)
	if err != nil {
		return domain.AccessCode{}, err
	}
	row, qerr := dbq.New(r.pool).UpdateAccessCodePermissions(ctx, *params)
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return domain.AccessCode{}, domain.ErrCodeInvalid
		}
		return domain.AccessCode{}, fmt.Errorf("update access code permissions: %w", qerr)
	}
	return toDomainCode(&row), nil
}

func buildUpdatePermissionsParams(
	ownerID, codeID string, perms []domain.PathPermission,
) (*dbq.UpdateAccessCodePermissionsParams, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	codeUUID, err := parseUUID(codeID)
	if err != nil {
		return nil, fmt.Errorf(errParseCodeIDPrefix, err)
	}
	encoded, jerr := json.Marshal(perms)
	if jerr != nil {
		return nil, fmt.Errorf("marshal corpus permissions: %w", jerr)
	}
	return &dbq.UpdateAccessCodePermissionsParams{
		ID: codeUUID, OwnerID: ownerUUID, CorpusPermissions: encoded,
	}, nil
}

// Revoke 把 code.status 改成 'revoked'；GetAccessCode（只查 active）从此跳过它。
func (r *CodeRepo) Revoke(ctx context.Context, ownerID, codeID string) error {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	codeUUID, err := parseUUID(codeID)
	if err != nil {
		return fmt.Errorf(errParseCodeIDPrefix, err)
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
		return domain.CodeMember{}, fmt.Errorf(errParseCodeIDPrefix, err)
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
		return nil, fmt.Errorf(errParseCodeIDPrefix, err)
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
		return domain.AccessCode{}, fmt.Errorf(errParseCodeIDPrefix, err)
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
		return domain.AccessCode{}, fmt.Errorf(errParseCodeIDPrefix, perr)
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
		Status:               c.Status,
		CreatedAt:            c.CreatedAt.Time,
		MaxSessionsPerMember: c.MaxSessionsPerMember,
		MaxTurnsPerSession:   c.MaxTurnsPerSession,
		MaxBookings:          c.MaxBookings,
		SuggestedQuestions:   decodeStringJSON(c.SuggestedQuestions),
		CorpusPermissions:    decodePermissionsJSON(c.CorpusPermissions),
		GrantedSkills:        c.GrantedSkills,
	}
	if c.ExpiresAt.Valid {
		t := c.ExpiresAt.Time
		out.ExpiresAt = &t
	}
	return out
}

func decodeStringJSON(raw []byte) []string {
	if len(raw) == 0 {
		return []string{}
	}
	var out []string
	if err := json.Unmarshal(raw, &out); err != nil {
		return []string{}
	}
	return out
}

func decodePermissionsJSON(raw []byte) []domain.PathPermission {
	if len(raw) == 0 {
		return []domain.PathPermission{}
	}
	var out []domain.PathPermission
	if err := json.Unmarshal(raw, &out); err != nil {
		return []domain.PathPermission{}
	}
	return out
}

func ptrToTimestamptz(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{Valid: false}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
}
