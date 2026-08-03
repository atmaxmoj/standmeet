// owners_handle.go —— Repo 改 handle 的事务路径。从 owners.go 拆出来
// 让本体文件守 350 行上限。
//
// UpdateHandle = 一次性原子地把 owners.handle 改成新值 + 把旧 handle 写
// handle_aliases，让老链接仍可 resolve（详见 internal/postgres/auth.go
// GetByHandle）。唯一约束冲突翻 ErrHandleTaken。

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// UpdateHandle —— owner 改 handle 一组 atomic：先读旧 handle、UPDATE owners
// 设新 handle、把旧 handle 写进 handle_aliases。一个事务里完成；唯一约束
// 冲突（handle 被别人占）翻译成 ErrHandleTaken。
func (r *Repo) UpdateHandle(
	ctx context.Context, ownerID, newHandle string,
) (entity.Owner, error) {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return entity.Owner{}, fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	tx, terr := r.pool.Begin(ctx)
	if terr != nil {
		return entity.Owner{}, fmt.Errorf("begin tx: %w", terr)
	}
	ownerRow, txErr := updateHandleTx(ctx, tx, pgID, newHandle)
	return commitOrRollback(ctx, tx, &ownerRow, txErr, "commit update handle")
}

// commitOrRollback —— tx 收尾通用 helper：txErr 非 nil 就 rollback；nil 就
// commit。让 UpdateHandle 自己 cyclo 友好。ownerRow 用 pointer 避免 hugeParam。
func commitOrRollback(
	ctx context.Context, tx pgx.Tx, ownerRow *entity.Owner, txErr error, commitTag string,
) (entity.Owner, error) {
	if txErr != nil {
		if rerr := tx.Rollback(ctx); rerr != nil {
			return entity.Owner{}, errors.Join(txErr, fmt.Errorf("rollback: %w", rerr))
		}
		return entity.Owner{}, txErr
	}
	if cerr := tx.Commit(ctx); cerr != nil {
		return entity.Owner{}, fmt.Errorf("%s: %w", commitTag, cerr)
	}
	return *ownerRow, nil
}

func updateHandleTx(
	ctx context.Context, tx pgx.Tx, ownerID pgtype.UUID, newHandle string,
) (entity.Owner, error) {
	q := db.New(tx)
	old, gerr := q.GetOwnerByID(ctx, ownerID)
	if gerr != nil {
		return entity.Owner{}, fmt.Errorf("get owner: %w", gerr)
	}
	if old.Handle == newHandle {
		return toDomainOwner(&old), nil
	}
	if uerr := doUpdateHandle(ctx, q, ownerID, newHandle); uerr != nil {
		return entity.Owner{}, uerr
	}
	aliasParams := db.AddHandleAliasParams{Handle: old.Handle, OwnerID: ownerID}
	if aerr := q.AddHandleAlias(ctx, aliasParams); aerr != nil {
		return entity.Owner{}, fmt.Errorf("add alias: %w", aerr)
	}
	old.Handle = newHandle
	return toDomainOwner(&old), nil
}

func doUpdateHandle(
	ctx context.Context, q *db.Queries, ownerID pgtype.UUID, newHandle string,
) error {
	_, err := q.UpdateOwnerHandle(ctx, db.UpdateOwnerHandleParams{ID: ownerID, Handle: newHandle})
	if err == nil {
		return nil
	}
	constraint, isUnique := pgstore.UniqueViolation(err)
	if isUnique && constraint == "owners_handle_key" {
		return entity.ErrHandleTaken
	}
	return fmt.Errorf("update handle: %w", err)
}
