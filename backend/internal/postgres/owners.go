// OwnerRepo wrap sqlc 生成的 dbq.Queries。
// 把 pgtype.* 映射到 domain.Owner 纯 Go 类型，让 usecase / routes 层
// 不用知道 pgtype。

package postgres

import (
	"context"
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
		ID:        formatUUID(o.ID),
		Email:     o.Email,
		Handle:    o.Handle,
		FullName:  o.FullName,
		Location:  o.Location,
		CreatedAt: o.CreatedAt.Time,
	}
}
