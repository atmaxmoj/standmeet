// auth.go —— login 流程需要的 password_hash + owner profile 查询。
// 这些 method 跟 OwnerRepo 同包，但 domain.Owner 不含 password_hash，
// 所以单独函数返回 (id, hash) 元组给 usecases 层用。

package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres/dbq"
)

// Credentials 是 login 所需的最小信息：用 ID 颁发 session，用 hash 比对密码。
// Handle 也带上让 LoginOutput 不用再额外查一次（前端 redirect 用）。
type Credentials struct {
	OwnerID      string
	PasswordHash string
	Handle       string
}

// GetCredentialsByEmail 拿 owner_id + password_hash；email 不存在返回
// domain.ErrOwnerNotFound（usecase 层翻译成 401，避免暴露"用户存在与否"）。
func (r *OwnerRepo) GetCredentialsByEmail(ctx context.Context, email string) (Credentials, error) {
	q := dbq.New(r.pool)
	row, err := q.GetOwnerByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Credentials{}, domain.ErrOwnerNotFound
		}
		return Credentials{}, fmt.Errorf("get owner by email: %w", err)
	}
	return Credentials{
		OwnerID:      formatUUID(row.ID),
		PasswordHash: row.PasswordHash,
		Handle:       row.Handle,
	}, nil
}

// GetByHandle 用 handle（URL 段）反查 owner profile。先查 owners.handle；
// 未命中再走 handle_aliases —— owner 改 handle 后旧 handle 也能 resolve。
// 不存在返 ErrOwnerNotFound。
func (r *OwnerRepo) GetByHandle(ctx context.Context, handle string) (domain.Owner, error) {
	q := dbq.New(r.pool)
	row, err := q.GetOwnerByHandle(ctx, handle)
	if err == nil {
		return toDomainOwner(&row), nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return domain.Owner{}, fmt.Errorf("get owner by handle: %w", err)
	}
	return r.getByAlias(ctx, handle)
}

func (r *OwnerRepo) getByAlias(ctx context.Context, handle string) (domain.Owner, error) {
	q := dbq.New(r.pool)
	row, err := q.GetOwnerByHandleAlias(ctx, handle)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Owner{}, domain.ErrOwnerNotFound
		}
		return domain.Owner{}, fmt.Errorf("get owner by alias: %w", err)
	}
	return aliasRowToDomainOwner(&row), nil
}

// aliasRowToDomainOwner —— alias JOIN 用的 owner 子集（无 password_hash /
// custom_domain），映射到 domain.Owner identity。settings 不在这条路径上
// 提取——/<handle> 公开页用不到 BYOAI / AI settings。
func aliasRowToDomainOwner(o *dbq.SelectOwnerForAlias) domain.Owner {
	return domain.Owner{
		ID:        formatUUID(o.ID),
		Email:     o.Email,
		Handle:    o.Handle,
		FullName:  o.FullName,
		Location:  o.Location,
		CreatedAt: o.CreatedAt.Time,
	}
}

// GetByID 拿 owner 公开 profile，给 /api/admin/me 用。
func (r *OwnerRepo) GetByID(ctx context.Context, id string) (domain.Owner, error) {
	q := dbq.New(r.pool)
	pgID, perr := parseUUID(id)
	if perr != nil {
		return domain.Owner{}, fmt.Errorf("parse owner id: %w", perr)
	}
	row, err := q.GetOwnerByID(ctx, pgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Owner{}, domain.ErrOwnerNotFound
		}
		return domain.Owner{}, fmt.Errorf("get owner by id: %w", err)
	}
	return toDomainOwner(&row), nil
}
