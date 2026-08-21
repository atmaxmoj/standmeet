// vault_import_receipt.go —— 「上一次 vault 导入」这个事实的读写（UX-62）。
//
// 账：导入是**定义这个产品 ground truth 的那个操作**，而这个事实以前在库里没有落点 ——
// 导入完屏幕上冒一行 `31 new · 20 updated`，刷新就没了。于是装着 1028 条笔记的实例，
// 和一个从没导过的空实例，在 /admin/obsidian 上长得一模一样。隔壁 /admin/sources
// 每一行至少说得出 `never fetched`。
//
// 单独成文件而不是塞进 owners.go：它是一个**能力自己的**读写对，不是 owner 设置的一部分。

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// 回执这个类型住在 entity（`vault_import.go`）：仓储写它、用例读它、路由渲它，
// 三层说的是同一个词。

// RecordVaultImport —— 记下这一次导入。命中 0 行 = owner 不在了，说出来而不是静静成功。
func (r *Repo) RecordVaultImport(
	ctx context.Context, ownerID string, rec entity.VaultImportReceipt,
) error {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	rows, err := db.New(r.pool).RecordVaultImport(ctx, db.RecordVaultImportParams{
		ID:                     pgID,
		LastVaultImportNew:     int32(rec.New),
		LastVaultImportUpdated: int32(rec.Updated),
		LastVaultImportSkipped: int32(rec.Skipped),
		LastVaultImportDeleted: int32(rec.Deleted),
	})
	if err != nil {
		return fmt.Errorf("record vault import: %w", err)
	}
	if rows == 0 {
		return entity.ErrOwnerNotFound
	}
	return nil
}

// GetVaultImportReceipt —— 读上一次导入。没导过 → 零值 At，由呈现层说成 "never imported"。
func (r *Repo) GetVaultImportReceipt(
	ctx context.Context, ownerID string,
) (entity.VaultImportReceipt, error) {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return entity.VaultImportReceipt{}, fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	row, err := db.New(r.pool).GetOwnerByID(ctx, pgID)
	if err != nil {
		if errors.Is(err, pgxErrNoRows()) {
			return entity.VaultImportReceipt{}, entity.ErrOwnerNotFound
		}
		return entity.VaultImportReceipt{}, fmt.Errorf("get vault import receipt: %w", err)
	}
	out := entity.VaultImportReceipt{
		New:     int(row.LastVaultImportNew),
		Updated: int(row.LastVaultImportUpdated),
		Skipped: int(row.LastVaultImportSkipped),
		Deleted: int(row.LastVaultImportDeleted),
	}
	if row.LastVaultImportAt.Valid {
		out.At = row.LastVaultImportAt.Time
	}
	return out, nil
}
