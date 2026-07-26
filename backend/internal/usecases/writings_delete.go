// writings_delete.go —— 物理删 writing + 它名下所有 asset（MinIO blob + DB 行）。
//
// 顺序：list keys（无 tx）→ DeleteBlobsStrict（MinIO，任一失败 abort）→
// tx (DELETE asset 行 + DELETE writing 行) → commit。
//
// 顺序刻意是 "blob 先删，DB 后删" —— invariant 是 blob 生命周期 ⊆ writing
// 生命周期，避免 DB 行已删 / MinIO blob 残留的 silent orphan 情形。
//
// 失败模式：
//   - MinIO 删一半挂 → DB 不动；owner retry，MinIO 幂等 (S3 spec 204 even
//     for non-existent) + DB 幂等 → 安全
//   - DB tx commit 挂（已删完 MinIO blob）→ DB 行还在但 blob 已空 → 后续
//     retry 走同路径：list 还能列到 asset 行（DB 没动），MinIO 删返 204
//     OK，DB tx 这次成功 → 闭合

package usecases

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/apierr"
	"github.com/jackc/pgx/v5"
)

// DeleteWritingWithAssets —— 物理删 writing + 它名下所有 assets。详见文件 doc。
func DeleteWritingWithAssets(
	ctx context.Context, deps WritingsTxDeps, ownerID, writingID string,
) error {
	if ownerID == "" || writingID == "" {
		return apierr.ErrEmptyField
	}
	keys, kerr := listAssetKeys(ctx, deps, writingID)
	if kerr != nil {
		return kerr
	}
	if derr := DeleteBlobsStrict(ctx, deps.Assets, keys); derr != nil {
		return derr
	}
	return deleteWritingInTx(ctx, deps, ownerID, writingID)
}

func listAssetKeys(
	ctx context.Context, deps WritingsTxDeps, writingID string,
) ([]string, error) {
	assets, err := deps.Assets.Repo.ListByHolder(ctx, writingID)
	if err != nil {
		return nil, fmt.Errorf("list assets: %w", err)
	}
	keys := make([]string, 0, len(assets))
	for i := range assets {
		keys = append(keys, assets[i].StorageKey)
	}
	return keys, nil
}

func deleteWritingInTx(
	ctx context.Context, deps WritingsTxDeps, ownerID, writingID string,
) error {
	tx, err := deps.Writings.Pool().Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	if derr := runDeleteRows(ctx, deps, tx, ownerID, writingID); derr != nil {
		if rerr := tx.Rollback(ctx); rerr != nil {
			_ = rerr
		}
		return derr
	}
	if cerr := tx.Commit(ctx); cerr != nil {
		return fmt.Errorf("commit delete writing: %w", cerr)
	}
	return nil
}

func runDeleteRows(
	ctx context.Context, deps WritingsTxDeps, tx pgx.Tx, ownerID, writingID string,
) error {
	if _, derr := deps.Assets.Repo.DeleteByHolderTx(ctx, tx, writingID); derr != nil {
		return fmt.Errorf("delete assets: %w", derr)
	}
	if perr := deps.Writings.DeleteTx(ctx, tx, ownerID, writingID); perr != nil {
		return fmt.Errorf("delete writing: %w", perr)
	}
	return nil
}
