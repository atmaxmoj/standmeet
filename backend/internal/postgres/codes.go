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

// CreateCodeInput —— 创建 access code 入参。AssumedRoleID 必填（caller
// usecase 不显式给则默认指 vanilla）。
type CreateCodeInput struct {
	ExpiresAt            *time.Time
	MaxSessionsPerMember *int32
	MaxTurnsPerSession   *int32
	MaxBookings          *int32
	OwnerID              string
	Code                 string
	Label                string
	Purpose              string
	AssumedRoleID        string
	SuggestedQuestions   []string
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
	roleUUID, rerr := parseUUID(in.AssumedRoleID)
	if rerr != nil {
		return nil, fmt.Errorf("parse assumed_role_id: %w", rerr)
	}
	qs, jerr := json.Marshal(in.SuggestedQuestions)
	if jerr != nil {
		return nil, fmt.Errorf("marshal suggested questions: %w", jerr)
	}
	return &dbq.CreateAccessCodeParams{
		OwnerID:              ownerUUID,
		Code:                 in.Code,
		Label:                in.Label,
		Purpose:              in.Purpose,
		SuggestedQuestions:   qs,
		ExpiresAt:            ptrToTimestamptz(in.ExpiresAt),
		MaxSessionsPerMember: in.MaxSessionsPerMember,
		MaxTurnsPerSession:   in.MaxTurnsPerSession,
		MaxBookings:          in.MaxBookings,
		AssumedRoleID:        roleUUID,
	}, nil
}

// UpdateRole —— 改 code 的 assumed_role_id。新 role 必须属于同 owner（caller
// 校验过）。schema NOT NULL 后 role id 必填。
func (r *CodeRepo) UpdateRole(
	ctx context.Context, ownerID, codeID, roleID string,
) (domain.AccessCode, error) {
	params, perr := buildUpdateCodeRoleParams(ownerID, codeID, roleID)
	if perr != nil {
		return domain.AccessCode{}, perr
	}
	row, qerr := dbq.New(r.pool).UpdateAccessCodeRole(ctx, *params)
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return domain.AccessCode{}, domain.ErrCodeInvalid
		}
		return domain.AccessCode{}, fmt.Errorf("update access code role: %w", qerr)
	}
	return toDomainCode(&row), nil
}

func buildUpdateCodeRoleParams(
	ownerID, codeID, roleID string,
) (*dbq.UpdateAccessCodeRoleParams, error) {
	ownerUUID, oerr := parseUUID(ownerID)
	if oerr != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	codeUUID, cerr := parseUUID(codeID)
	if cerr != nil {
		return nil, fmt.Errorf(errParseCodeIDPrefix, cerr)
	}
	roleUUID, rerr := parseUUID(roleID)
	if rerr != nil {
		return nil, fmt.Errorf("parse role id: %w", rerr)
	}
	return &dbq.UpdateAccessCodeRoleParams{
		ID: codeUUID, OwnerID: ownerUUID, AssumedRoleID: roleUUID,
	}, nil
}

// UpdatePermissions / buildUpdatePermissionsParams 在 A.3-IAM-5 删 ——
// corpus_permissions 列已 drop，ACL 走 Role.CorpusURIs。

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

// member CRUD (GetOrCreateMember / ListMembers / toDomainMember) 拆到
// codes_members.go 守 max-lines。

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

// Get/List/decode helpers 拆到 codes_query.go 守 max-lines。

func ptrToTimestamptz(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{Valid: false}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
}
