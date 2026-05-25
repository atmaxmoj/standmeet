// posts_delete.go —— 物理删 post + 它名下所有 asset（MinIO blob + DB 行）。
//
// 顺序：list keys（无 tx）→ DeleteBlobsStrict（MinIO，任一失败 abort）→
// tx (DELETE asset 行 + DELETE post 行) → commit。
//
// 顺序刻意是 "blob 先删，DB 后删" —— invariant 是 blob 生命周期 ⊆ post
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

	"github.com/jackc/pgx/v5"
)

// DeletePostWithAssets —— 物理删 post + 它名下所有 assets。详见文件 doc。
func DeletePostWithAssets(
	ctx context.Context, deps PostsTxDeps, ownerID, postID string,
) error {
	if ownerID == "" || postID == "" {
		return ErrEmptyField
	}
	keys, kerr := listAssetKeys(ctx, deps, postID)
	if kerr != nil {
		return kerr
	}
	if derr := DeleteBlobsStrict(ctx, deps.Assets, keys); derr != nil {
		return derr
	}
	return deletePostInTx(ctx, deps, ownerID, postID)
}

func listAssetKeys(
	ctx context.Context, deps PostsTxDeps, postID string,
) ([]string, error) {
	assets, err := deps.Assets.Repo.ListByHolder(ctx, postID)
	if err != nil {
		return nil, fmt.Errorf("list assets: %w", err)
	}
	keys := make([]string, 0, len(assets))
	for i := range assets {
		keys = append(keys, assets[i].StorageKey)
	}
	return keys, nil
}

func deletePostInTx(
	ctx context.Context, deps PostsTxDeps, ownerID, postID string,
) error {
	tx, err := deps.Posts.Pool().Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	if derr := runDeleteRows(ctx, deps, tx, ownerID, postID); derr != nil {
		if rerr := tx.Rollback(ctx); rerr != nil {
			_ = rerr
		}
		return derr
	}
	if cerr := tx.Commit(ctx); cerr != nil {
		return fmt.Errorf("commit delete post: %w", cerr)
	}
	return nil
}

func runDeleteRows(
	ctx context.Context, deps PostsTxDeps, tx pgx.Tx, ownerID, postID string,
) error {
	if _, derr := deps.Assets.Repo.DeleteByHolderTx(ctx, tx, postID); derr != nil {
		return fmt.Errorf("delete assets: %w", derr)
	}
	if perr := deps.Posts.DeleteTx(ctx, tx, ownerID, postID); perr != nil {
		return fmt.Errorf("delete post: %w", perr)
	}
	return nil
}
