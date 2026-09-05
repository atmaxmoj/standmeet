// writings_delete.go —— physically deletes a writing and frees its asset references.
//
// Under the global asset pool (docs/design/global-assets.md) the writing's images are
// pool assets it merely *references* — they belong to the owner, may be shared with other
// entries, and are managed from Resources → Assets. So deleting a writing drops only its
// references (in the same tx as the writing row); the pool assets + their MinIO blobs
// survive. (Previously this deleted the blobs + asset rows outright — that would now
// destroy an asset another entry might still reference.)

package usecase

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/jackc/pgx/v5"
)

// DeleteWritingWithAssets —— deletes a writing and frees its asset references (the pool
// assets survive). Name kept for its callers; see the file doc for the pool semantics.
func DeleteWritingWithAssets(
	ctx context.Context, deps WritingsTxDeps, ownerID, writingID string,
) error {
	if ownerID == "" || writingID == "" {
		return apierr.ErrEmptyField
	}
	return deleteWritingInTx(ctx, deps, ownerID, writingID)
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
	derr := deps.Assets.Repo.DeleteReferencesByReferrerTx(ctx, tx, repo.RefKindCorpus, writingID)
	if derr != nil {
		return fmt.Errorf("free asset references: %w", derr)
	}
	if perr := deps.Writings.DeleteTx(ctx, tx, ownerID, writingID); perr != nil {
		return fmt.Errorf("delete writing: %w", perr)
	}
	return nil
}
