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

	"github.com/atmaxmoj/standmeet/internal/accessdomain"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
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
// usecase 不显式给则默认指 public）。
type CreateCodeInput struct {
	ExpiresAt          *time.Time
	MaxMembers         *int32
	MaxTurnsPerSession *int32
	PromptID           *string
	OwnerID            string
	Code               string
	Label              string
	Purpose            string
	AssumedRoleID      string
	InlinePrompt       string
	Ghosts             []string
}

// Create 写一条 access_code。
func (r *CodeRepo) Create(
	ctx context.Context, in *CreateCodeInput) (accessdomain.AccessCode, error,
) {
	params, perr := buildCreateCodeParams(in)
	if perr != nil {
		return accessdomain.AccessCode{}, perr
	}
	row, err := dbq.New(r.pool).CreateAccessCode(ctx, *params)
	if err != nil {
		if name, hit := pgUniqueViolation(err); hit && name == "access_codes_code_key" {
			return accessdomain.AccessCode{}, accessdomain.ErrCodeTaken
		}
		return accessdomain.AccessCode{}, fmt.Errorf("create access code: %w", err)
	}
	return toDomainCode(&row), nil
}

// CreateAccessCode —— Create 的 domain-input 包装；MCP cap 用 (mcp 包不能
// import postgres struct)。内部只是把 accessdomain.CreateAccessCodeInput 复制到
// postgres.CreateCodeInput 再 Create。
func (r *CodeRepo) CreateAccessCode(
	ctx context.Context, in *accessdomain.CreateAccessCodeInput,
) (accessdomain.AccessCode, error) {
	return r.Create(ctx, &CreateCodeInput{
		OwnerID:            in.OwnerID,
		Code:               in.Code,
		Label:              in.Label,
		Purpose:            in.Purpose,
		AssumedRoleID:      in.AssumedRoleID,
		Ghosts:             in.Ghosts,
		ExpiresAt:          in.ExpiresAt,
		MaxMembers:         in.MaxMembers,
		MaxTurnsPerSession: in.MaxTurnsPerSession,
		PromptID:           in.PromptID,
		InlinePrompt:       in.InlinePrompt,
	})
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
	promptUUID, perr := optionalUUID(in.PromptID)
	if perr != nil {
		return nil, fmt.Errorf("parse prompt_id: %w", perr)
	}
	qs, jerr := json.Marshal(in.Ghosts)
	if jerr != nil {
		return nil, fmt.Errorf("marshal suggested questions: %w", jerr)
	}
	return &dbq.CreateAccessCodeParams{
		OwnerID:            ownerUUID,
		Code:               in.Code,
		Label:              in.Label,
		Purpose:            in.Purpose,
		Ghosts:             qs,
		ExpiresAt:          ptrToTimestamptz(in.ExpiresAt),
		MaxMembers:         in.MaxMembers,
		MaxTurnsPerSession: in.MaxTurnsPerSession,
		AssumedRoleID:      roleUUID,
		PromptID:           promptUUID,
		InlinePrompt:       in.InlinePrompt,
	}, nil
}

// UpdateRole —— 改 code 的 assumed_role_id。新 role 必须属于同 owner（caller
// 校验过）。schema NOT NULL 后 role id 必填。
func (r *CodeRepo) UpdateRole(
	ctx context.Context, ownerID, codeID, roleID string,
) (accessdomain.AccessCode, error) {
	params, perr := buildUpdateCodeRoleParams(ownerID, codeID, roleID)
	if perr != nil {
		return accessdomain.AccessCode{}, perr
	}
	row, qerr := dbq.New(r.pool).UpdateAccessCodeRole(ctx, *params)
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return accessdomain.AccessCode{}, accessdomain.ErrCodeInvalid
		}
		return accessdomain.AccessCode{}, fmt.Errorf("update access code role: %w", qerr)
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
//
// 0-row match (wrong owner / unknown code id) 返 accessdomain.ErrCodeInvalid 让上层
// (admin REST + MCP) 都能统一翻译成"code not found"，而不是默默 OK 让 owner 误以
// 为撤销成功。原 sqlc-generated RevokeAccessCode 走 Exec 丢弃 CommandTag，看不
// 到 RowsAffected；这里 bypass 直接 pool.Exec 拿 tag。
func (r *CodeRepo) Revoke(ctx context.Context, ownerID, codeID string) error {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	codeUUID, err := parseUUID(codeID)
	if err != nil {
		return fmt.Errorf(errParseCodeIDPrefix, err)
	}
	tag, rerr := r.pool.Exec(ctx,
		`UPDATE access_codes SET status='revoked' WHERE id=$1 AND owner_id=$2`,
		codeUUID, ownerUUID,
	)
	if rerr != nil {
		return fmt.Errorf("revoke access code: %w", rerr)
	}
	if tag.RowsAffected() == 0 {
		return accessdomain.ErrCodeInvalid
	}
	return nil
}

// member CRUD (GetOrCreateMember / ListMembers / toDomainMember) 拆到
// codes_members.go 守 max-lines。

// UpdateQuotas 改某 code 的配额；返回新行（让 admin UI 直接刷）。
func (r *CodeRepo) UpdateQuotas(
	ctx context.Context, ownerID, codeID string, maxTurns, maxMembers *int32,
) (accessdomain.AccessCode, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return accessdomain.AccessCode{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	codeUUID, err := parseUUID(codeID)
	if err != nil {
		return accessdomain.AccessCode{}, fmt.Errorf(errParseCodeIDPrefix, err)
	}
	q := dbq.New(r.pool)
	row, qerr := q.UpdateAccessCodeQuotas(ctx, dbq.UpdateAccessCodeQuotasParams{
		ID: codeUUID, OwnerID: ownerUUID,
		MaxTurnsPerSession: maxTurns, MaxMembers: maxMembers,
	})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return accessdomain.AccessCode{}, accessdomain.ErrCodeInvalid
		}
		return accessdomain.AccessCode{}, fmt.Errorf("update access code quotas: %w", qerr)
	}
	return toDomainCode(&row), nil
}

// SetGhostEvidence —— F-A-10 per-code 覆盖:nil = 继承 role 的开关;非 nil = 显式覆盖。返回新行。
func (r *CodeRepo) SetGhostEvidence(
	ctx context.Context, ownerID, codeID string, val *bool,
) (accessdomain.AccessCode, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return accessdomain.AccessCode{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	codeUUID, err := parseUUID(codeID)
	if err != nil {
		return accessdomain.AccessCode{}, fmt.Errorf(errParseCodeIDPrefix, err)
	}
	row, qerr := dbq.New(r.pool).SetAccessCodeGhostEvidence(ctx,
		dbq.SetAccessCodeGhostEvidenceParams{
			ID: codeUUID, OwnerID: ownerUUID, RequireGhostEvidence: val,
		})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return accessdomain.AccessCode{}, accessdomain.ErrCodeInvalid
		}
		return accessdomain.AccessCode{}, fmt.Errorf("set access code ghost evidence: %w", qerr)
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
