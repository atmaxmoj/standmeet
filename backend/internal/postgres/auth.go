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
type Credentials struct {
	OwnerID      string
	PasswordHash string
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
	}, nil
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
