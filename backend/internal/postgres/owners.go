// OwnerRepo wrap sqlc 生成的 dbq.Queries。
// 把 pgtype.* 映射到 domain.Owner 纯 Go 类型，让 usecase / routes 层
// 不用知道 pgtype。

package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres/dbq"
)

// pgxErrNoRows —— helper：避免直接在多处 import pgx.ErrNoRows，让 grep 起点一致。
func pgxErrNoRows() error { return pgx.ErrNoRows }

// pgUniqueViolationSQLState 是 unique constraint 冲突的 SQLSTATE，让
// pgUniqueViolation 翻译 DB 错误到 domain sentinel 时 hardcode 不出现。
const pgUniqueViolationSQLState = "23505"

// OwnerRepo 提供 owner CRUD（当前只用 Create 和 Count；后续扩展）。
type OwnerRepo struct {
	pool *Pool
}

// NewOwnerRepo 构造 OwnerRepo。
func NewOwnerRepo(pool *Pool) *OwnerRepo {
	return &OwnerRepo{pool: pool}
}

// Count 返回 owners 表行数（用于"是否有 owner"的判定）。
func (r *OwnerRepo) Count(ctx context.Context) (int64, error) {
	q := dbq.New(r.pool)
	n, err := q.CountOwners(ctx)
	if err != nil {
		return 0, fmt.Errorf("count owners: %w", err)
	}
	return n, nil
}

// FirstHandle 返最早 owner 的 handle；表为空返 ""（不报错，app 根路径
// 据此判断是否引导用户去 /setup）。
func (r *OwnerRepo) FirstHandle(ctx context.Context) (string, error) {
	q := dbq.New(r.pool)
	handle, err := q.GetFirstOwnerHandle(ctx)
	if err != nil {
		if errors.Is(err, pgxErrNoRows()) {
			return "", nil
		}
		return "", fmt.Errorf("get first owner handle: %w", err)
	}
	return handle, nil
}

// pgUniqueViolation 检测 pgx unique constraint 冲突，返回 constraint 名 +
// 是否命中。让 caller 把 DB-level 错误翻译成 domain sentinel error。
func pgUniqueViolation(err error) (string, bool) {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolationSQLState {
		return pgErr.ConstraintName, true
	}
	return "", false
}

// toDomainOwner 把 sqlc 生成的 dbq.Owner（带 pgtype.UUID / Timestamptz）
// 映射到 domain.Owner（纯 Go 类型）。pointer 接收避免 gocritic hugeParam。
func toDomainOwner(o *dbq.Owner) domain.Owner {
	return domain.Owner{
		ID:               formatUUID(o.ID),
		Email:            o.Email,
		Handle:           o.Handle,
		FullName:         o.FullName,
		Location:         o.Location,
		CreatedAt:        o.CreatedAt.Time,
		BYOAIEnabled:     o.ByoaiEnabled,
		BYOAIProviders:   decodeProviders(o.ByoaiProviders),
		BYOAIPublicBlurb: o.ByoaiPublicBlurb,
	}
}

// decodeProviders 把 byoai_providers jsonb 解到 []string。空 / 解失败返 nil；
// usecase 视 nil 为 "default providers"，handler 编码时按 [] 输出。
func decodeProviders(raw []byte) []string {
	if len(raw) == 0 {
		return nil
	}
	var out []string
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil
	}
	return out
}

// UpdateBYOAIInput —— Update 入参。字段顺序按 govet fieldalignment：
// strings 先（ptr at 0），slice 紧跟（ptr at 0 也连续），bool 末尾。
type UpdateBYOAIInput struct {
	OwnerID   string
	Blurb     string
	Providers []string
	Enabled   bool
}

// UpdateBYOAI 更新 owner 行的 byoai_enabled / providers / blurb，返回新行。
func (r *OwnerRepo) UpdateBYOAI(
	ctx context.Context, in *UpdateBYOAIInput,
) (domain.Owner, error) {
	params, perr := buildBYOAIParams(in)
	if perr != nil {
		return domain.Owner{}, perr
	}
	q := dbq.New(r.pool)
	row, uerr := q.UpdateOwnerBYOAI(ctx, params)
	if uerr != nil {
		if errors.Is(uerr, pgxErrNoRows()) {
			return domain.Owner{}, domain.ErrOwnerNotFound
		}
		return domain.Owner{}, fmt.Errorf("update byoai: %w", uerr)
	}
	return toDomainOwner(&row), nil
}

// buildBYOAIParams 把入参 normalize + marshal 一气呵成，让 UpdateBYOAI
// 自己 cyclo ≤ 5。
func buildBYOAIParams(in *UpdateBYOAIInput) (dbq.UpdateOwnerBYOAIParams, error) {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return dbq.UpdateOwnerBYOAIParams{}, fmt.Errorf("parse owner id: %w", err)
	}
	providers := in.Providers
	if providers == nil {
		providers = []string{}
	}
	encoded, merr := json.Marshal(providers)
	if merr != nil {
		return dbq.UpdateOwnerBYOAIParams{}, fmt.Errorf("marshal providers: %w", merr)
	}
	return dbq.UpdateOwnerBYOAIParams{
		ID:               ownerUUID,
		ByoaiEnabled:     in.Enabled,
		ByoaiProviders:   encoded,
		ByoaiPublicBlurb: in.Blurb,
	}, nil
}
