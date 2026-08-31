// auth.go —— login 流程需要的 password_hash + owner profile 查询。
// 这些 method 跟 Repo 同包，但 Owner 不含 password_hash，
// 所以单独函数返回 (id, hash) 元组给 usecases 层用。

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// Credentials 是 login 所需的最小信息：用 ID 颁发 session，用 hash 比对密码。
// Handle 也带上让 LoginOutput 不用再额外查一次（前端 redirect 用）。
type Credentials struct {
	OwnerID      string
	PasswordHash string
	Handle       string
	// RecoveryHash —— #100 recovery phrase 的 hash(空 = 没生成/已用)。/recover 对这列。
	RecoveryHash string
}

// GetCredentialsByEmail 拿 owner_id + password_hash；email 不存在返回
// ErrOwnerNotFound（usecase 层翻译成 401，避免暴露"用户存在与否"）。
func (r *Repo) GetCredentialsByEmail(ctx context.Context, email string) (Credentials, error) {
	q := db.New(r.pool)
	row, err := q.GetOwnerByEmail(ctx, NormalizeEmail(email))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Credentials{}, entity.ErrOwnerNotFound
		}
		return Credentials{}, fmt.Errorf("get owner by email: %w", err)
	}
	return Credentials{
		OwnerID:      pgstore.FormatUUID(row.ID),
		PasswordHash: row.PasswordHash,
		Handle:       row.Handle,
		RecoveryHash: row.RecoveryHash,
	}, nil
}

// GetByHandle 用 handle（URL 段）反查 owner profile。先查 owners.handle；
// 未命中再走 handle_aliases —— owner 改 handle 后旧 handle 也能 resolve。
// 不存在返 ErrOwnerNotFound。
func (r *Repo) GetByHandle(ctx context.Context, handle string) (entity.Owner, error) {
	q := db.New(r.pool)
	row, err := q.GetOwnerByHandle(ctx, handle)
	if err == nil {
		return toDomainOwner(&row), nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return entity.Owner{}, fmt.Errorf("get owner by handle: %w", err)
	}
	return r.getByAlias(ctx, handle)
}

func (r *Repo) getByAlias(ctx context.Context, handle string) (entity.Owner, error) {
	q := db.New(r.pool)
	row, err := q.GetOwnerByHandleAlias(ctx, handle)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Owner{}, entity.ErrOwnerNotFound
		}
		return entity.Owner{}, fmt.Errorf("get owner by alias: %w", err)
	}
	return aliasRowToDomainOwner(&row), nil
}

// aliasRowToDomainOwner —— alias JOIN 用的 owner 子集（无 password_hash /
// custom_domain），映射到 Owner identity。settings 不在这条路径上
// 提取——/<handle> 公开页用不到 BYOAI / AI settings。
func aliasRowToDomainOwner(o *db.GetOwnerByHandleAliasRow) entity.Owner {
	return entity.Owner{
		ID:        pgstore.FormatUUID(o.ID),
		Email:     o.Email,
		Handle:    o.Handle,
		FullName:  o.FullName,
		Location:  o.Location,
		CreatedAt: o.CreatedAt.Time,
	}
}

// OwnerExists —— 轻量"这个 ownerID 现在在表里吗"诊断（FK 错误 / 鉴权
// debug 用）。不抛 ErrOwnerNotFound，返 bool 让 caller 自己 log。
func (r *Repo) OwnerExists(ctx context.Context, id string) (bool, error) {
	pgID, perr := pgstore.ParseUUID(id)
	if perr != nil {
		return false, fmt.Errorf("parse owner id: %w", perr)
	}
	var exists bool
	row := r.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM owners WHERE id = $1)`, pgID)
	if serr := row.Scan(&exists); serr != nil {
		return false, fmt.Errorf("scan owner exists: %w", serr)
	}
	return exists, nil
}

// PublicURL —— owner 的 public base URL(connector 拼 oauth redirect 的窄读端口)。
func (r *Repo) PublicURL(ctx context.Context, ownerID string) (string, error) {
	o, err := r.GetByID(ctx, ownerID)
	if err != nil {
		return "", err
	}
	return o.PublicURL, nil
}

// GetByID 拿 owner 公开 profile，给 /api/admin/me 用。
func (r *Repo) GetByID(ctx context.Context, id string) (entity.Owner, error) {
	q := db.New(r.pool)
	pgID, perr := pgstore.ParseUUID(id)
	if perr != nil {
		return entity.Owner{}, fmt.Errorf("parse owner id: %w", perr)
	}
	row, err := q.GetOwnerByID(ctx, pgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Owner{}, entity.ErrOwnerNotFound
		}
		return entity.Owner{}, fmt.Errorf("get owner by id: %w", err)
	}
	return toDomainOwner(&row), nil
}
