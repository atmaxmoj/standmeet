// vault_import_receipt.go —— reads and writes the fact of "the last vault
// import" (UX-62).
//
// The bill: import is **the operation that defines this product's ground
// truth**, and this fact used to have no place to land in the database —
// a line like `31 new · 20 updated` flashed on screen when import
// finished, then vanished on refresh. So an instance holding 1028 notes
// and an instance that had never been imported looked identical on
// /admin/obsidian. The neighboring /admin/sources can at least say
// `never fetched` for every row.
//
// This is its own file instead of living in owners.go: it's a read/write
// pair belonging **to the capability itself**, not part of owner settings.

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// The receipt type lives in entity (`vault_import.go`): repo writes it,
// usecase reads it, routes render it — all three layers speak the same
// word.

// RecordVaultImport —— records this import. Hitting 0 rows means the
// owner is gone; say so instead of silently succeeding.
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

// GetVaultImportReceipt —— reads the last import. Never imported → zero-
// value At, which the presentation layer renders as "never imported".
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
