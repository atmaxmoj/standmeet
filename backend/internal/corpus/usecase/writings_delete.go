// writings_delete.go —— physically deletes a writing + every asset under it (MinIO blob +
// DB row).
//
// Order: list keys (no tx) → DeleteBlobsStrict (MinIO, abort on any failure) →
// tx (DELETE asset rows + DELETE writing row) → commit.
//
// The order is deliberately "blob first, DB second" — the invariant is blob lifetime ⊆
// writing lifetime, avoiding the silent-orphan case where the DB row is gone but a MinIO
// blob is left behind.
//
// Failure modes:
//   - MinIO deletion dies partway through → DB untouched; owner retries, MinIO is
//     idempotent (S3 spec returns 204 even for a non-existent key) + DB is idempotent → safe
//   - DB tx commit dies (MinIO blobs already deleted) → DB row still there but the blob is
//     already gone → the retry takes the same path: list still finds the asset row (DB
//     untouched), MinIO delete returns 204 OK, the DB tx succeeds this time → closed

package usecase

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/jackc/pgx/v5"
)

// DeleteWritingWithAssets —— physically deletes a writing + every asset under it. See the
// file doc for details.
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
