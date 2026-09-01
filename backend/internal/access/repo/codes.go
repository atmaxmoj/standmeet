// codes.go —— access_codes + code_members + conversations + messages Repository。

package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/access/db"
	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// errParseCodeIDPrefix —— "parse code id: %w" 字面在本文件 6+ 处出现，提常量。
const errParseCodeIDPrefix = "parse code id: %w"

// CodeRepo —— access_codes CRUD。
type CodeRepo struct {
	pool *pgstore.Pool
}

// NewCodeRepo 构造 CodeRepo。
func NewCodeRepo(pool *pgstore.Pool) *CodeRepo { return &CodeRepo{pool: pool} }

// CreateCodeInput —— 创建 access code 入参。AssumedRoleID 必填（caller
// usecase 不显式给则默认指 public）。
type CreateCodeInput struct {
	ExpiresAt          *time.Time
	MaxMembers         *int32
	MaxTurnsPerSession *int32
	PromptID           *string
	LimitPerPeriod     *entity.PeriodLimit
	Label              string
	Code               string
	Purpose            string
	AssumedRoleID      string
	InlinePrompt       string
	ProviderID         string
	OwnerID            string
	Ghosts             []string
}

// optStr —— 空串 → nil(ParseOptionalUUID 的"没给"形态);非空 → 指针。
// 可选外键在本域是空串,在 sqlc 那侧是 NULL,这一行就是那道翻译。
func optStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// Create 写一条 access_code。
func (r *CodeRepo) Create(
	ctx context.Context, in *CreateCodeInput) (entity.Code, error,
) {
	return createCodeOn(ctx, db.New(r.pool), in)
}

// CreateAccessCodeTx —— 在调用方**事务内**发码,给跨域调用方(job-loop application-commit:
// 写 application 行 + 发码必须同一 tx 原子)。access 不让别的域直接碰 access_codes DAO;经此
// 在共享 pgx.Tx 上发码,既保原子性又守域边界。参数是 pgx 原语(不外泄本域生成的 DBTX 类型)。
func CreateAccessCodeTx(
	ctx context.Context, tx pgx.Tx, in *entity.CreateAccessCodeInput,
) (entity.Code, error) {
	return createCodeOn(ctx, db.New(tx), accessInputToCreate(in))
}

// createCodeOn —— 在任意 DBTX(池连接或事务)上写一条 access_code。Create 与 CreateAccessCodeTx 共用。
func createCodeOn(ctx context.Context, q *db.Queries, in *CreateCodeInput) (entity.Code, error) {
	// 没给 code 就按 label 派生一个。每条建码路径都汇进这里,所以规则只此一份。
	in.Code = entity.DeriveCode(in.Code, in.Label)
	params, perr := buildCreateCodeParams(in)
	if perr != nil {
		return entity.Code{}, perr
	}
	row, err := q.CreateAccessCode(ctx, *params)
	if err != nil {
		if name, hit := pgstore.UniqueViolation(err); hit && name == "access_codes_code_key" {
			return entity.Code{}, entity.ErrCodeTaken
		}
		return entity.Code{}, fmt.Errorf("create access code: %w", err)
	}
	return CodeFromRow(&row), nil
}

// CreateAccessCode —— Create 的 domain-input 包装；MCP cap 用 (mcp 包不能
// import postgres struct)。内部只是把 CreateAccessCodeInput 复制到
// access.CreateCodeInput 再 Create。
func (r *CodeRepo) CreateAccessCode(
	ctx context.Context, in *entity.CreateAccessCodeInput,
) (entity.Code, error) {
	return r.Create(ctx, accessInputToCreate(in))
}

// accessInputToCreate —— CreateAccessCodeInput → CreateCodeInput 平移(字段一一对应)。
func accessInputToCreate(in *entity.CreateAccessCodeInput) *CreateCodeInput {
	return &CreateCodeInput{
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
		ProviderID:         in.ProviderID,
	}
}

// codeCreateIDs —— 建码要解的四个 id(两个必填、两个可选)。单拎出来是为了让
// buildCreateCodeParams 只剩"拼参数"这一件事。
type codeCreateIDs struct {
	owner    pgtype.UUID
	role     pgtype.UUID
	prompt   pgtype.UUID
	provider pgtype.UUID
}

func parseCodeCreateIDs(in *CreateCodeInput) (codeCreateIDs, error) {
	var out codeCreateIDs
	var err error
	if out.owner, err = pgstore.ParseUUID(in.OwnerID); err != nil {
		return out, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	if out.role, err = pgstore.ParseUUID(in.AssumedRoleID); err != nil {
		return out, fmt.Errorf("parse assumed_role_id: %w", err)
	}
	if out.prompt, err = pgstore.ParseOptionalUUID(in.PromptID); err != nil {
		return out, fmt.Errorf("parse prompt_id: %w", err)
	}
	if out.provider, err = pgstore.ParseOptionalUUID(optStr(in.ProviderID)); err != nil {
		return out, fmt.Errorf("parse provider_id: %w", err)
	}
	return out, nil
}

func buildCreateCodeParams(in *CreateCodeInput) (*db.CreateAccessCodeParams, error) {
	ids, err := parseCodeCreateIDs(in)
	if err != nil {
		return nil, err
	}
	qs, jerr := json.Marshal(in.Ghosts)
	if jerr != nil {
		return nil, fmt.Errorf("marshal suggested questions: %w", jerr)
	}
	// limit_per_period 是可空 jsonb：没设 → period 保持 nil → 存 SQL NULL（= 不限）。
	// 内联而不抽 helper：一个返回 nil []byte 的 helper 会撞 no-nil-container（happy path
	// 的容器返回不能是 nil），而这里 nil 恰恰是要的答案。局部 nil 变量不受那条守卫管。
	var period []byte
	if in.LimitPerPeriod != nil {
		var plerr error
		if period, plerr = json.Marshal(in.LimitPerPeriod); plerr != nil {
			return nil, fmt.Errorf("marshal limit_per_period: %w", plerr)
		}
	}
	return &db.CreateAccessCodeParams{
		ProviderID:         ids.provider,
		OwnerID:            ids.owner,
		Code:               in.Code,
		Label:              in.Label,
		Purpose:            in.Purpose,
		Ghosts:             qs,
		ExpiresAt:          ptrToTimestamptz(in.ExpiresAt),
		MaxMembers:         in.MaxMembers,
		MaxTurnsPerSession: in.MaxTurnsPerSession,
		AssumedRoleID:      ids.role,
		PromptID:           ids.prompt,
		InlinePrompt:       in.InlinePrompt,
		LimitPerPeriod:     period,
	}, nil
}

// UpdateRole —— 改 code 的 assumed_role_id。新 role 必须属于同 owner（caller
// 校验过）。schema NOT NULL 后 role id 必填。
func (r *CodeRepo) UpdateRole(
	ctx context.Context, ownerID, codeID, roleID string,
) (entity.Code, error) {
	params, perr := buildUpdateCodeRoleParams(ownerID, codeID, roleID)
	if perr != nil {
		return entity.Code{}, perr
	}
	row, qerr := db.New(r.pool).UpdateAccessCodeRole(ctx, *params)
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return entity.Code{}, entity.ErrCodeInvalid
		}
		return entity.Code{}, fmt.Errorf("update access code role: %w", qerr)
	}
	return CodeFromRow(&row), nil
}

func buildUpdateCodeRoleParams(
	ownerID, codeID, roleID string,
) (*db.UpdateAccessCodeRoleParams, error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	codeUUID, cerr := pgstore.ParseUUID(codeID)
	if cerr != nil {
		return nil, fmt.Errorf(errParseCodeIDPrefix, cerr)
	}
	roleUUID, rerr := pgstore.ParseUUID(roleID)
	if rerr != nil {
		return nil, fmt.Errorf("parse role id: %w", rerr)
	}
	return &db.UpdateAccessCodeRoleParams{
		ID: codeUUID, OwnerID: ownerUUID, AssumedRoleID: roleUUID,
	}, nil
}

// UpdatePermissions / buildUpdatePermissionsParams 在 A.3-IAM-5 删 ——
// corpus_permissions 列已 drop，ACL 走 Role.CorpusURIs。

// Revoke 把 code.status 改成 'revoked'；GetAccessCode（只查 active）从此跳过它。
//
// 0-row match (wrong owner / unknown code id) 返 ErrCodeInvalid 让上层
// (admin REST + MCP) 都能统一翻译成"code not found"，而不是默默 OK 让 owner 误以
// 为撤销成功。原 sqlc-generated RevokeAccessCode 走 Exec 丢弃 CommandTag，看不
// 到 RowsAffected；这里 bypass 直接 pool.Exec 拿 tag。
func (r *CodeRepo) Revoke(ctx context.Context, ownerID, codeID string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	codeUUID, err := pgstore.ParseUUID(codeID)
	if err != nil {
		return fmt.Errorf(errParseCodeIDPrefix, err)
	}
	tag, rerr := r.pool.Exec(
		ctx,
		`UPDATE access_codes SET status='revoked' WHERE id=$1 AND owner_id=$2`,
		codeUUID, ownerUUID,
	)
	if rerr != nil {
		return fmt.Errorf("revoke access code: %w", rerr)
	}
	if tag.RowsAffected() == 0 {
		return entity.ErrCodeInvalid
	}
	return nil
}

// member CRUD (GetOrCreateMember / ListMembers / toDomainMember) 拆到
// codes_members.go 守 max-lines。

// UpdateQuotas 改某 code 的配额；返回新行（让 admin UI 直接刷）。
func (r *CodeRepo) UpdateQuotas(
	ctx context.Context, ownerID, codeID string, maxTurns, maxMembers *int32,
) (entity.Code, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return entity.Code{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	codeUUID, err := pgstore.ParseUUID(codeID)
	if err != nil {
		return entity.Code{}, fmt.Errorf(errParseCodeIDPrefix, err)
	}
	q := db.New(r.pool)
	row, qerr := q.UpdateAccessCodeQuotas(ctx, db.UpdateAccessCodeQuotasParams{
		ID: codeUUID, OwnerID: ownerUUID,
		MaxTurnsPerSession: maxTurns, MaxMembers: maxMembers,
	})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return entity.Code{}, entity.ErrCodeInvalid
		}
		return entity.Code{}, fmt.Errorf("update access code quotas: %w", qerr)
	}
	return CodeFromRow(&row), nil
}

// SetGhostEvidence —— F-A-10 per-code 覆盖:nil = 继承 role 的开关;非 nil = 显式覆盖。返回新行。
func (r *CodeRepo) SetGhostEvidence(
	ctx context.Context, ownerID, codeID string, val *bool,
) (entity.Code, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return entity.Code{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	codeUUID, err := pgstore.ParseUUID(codeID)
	if err != nil {
		return entity.Code{}, fmt.Errorf(errParseCodeIDPrefix, err)
	}
	row, qerr := db.New(r.pool).SetAccessCodeGhostEvidence(ctx,
		db.SetAccessCodeGhostEvidenceParams{
			ID: codeUUID, OwnerID: ownerUUID, RequireGhostEvidence: val,
		})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return entity.Code{}, entity.ErrCodeInvalid
		}
		return entity.Code{}, fmt.Errorf("set access code ghost evidence: %w", qerr)
	}
	return CodeFromRow(&row), nil
}

// Get/List/decode helpers 拆到 codes_query.go 守 max-lines。

func ptrToTimestamptz(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{Valid: false}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
}
