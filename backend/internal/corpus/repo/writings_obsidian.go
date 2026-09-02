// writings_obsidian.go — the two WritingRepo methods related to Obsidian sync, split out
// so writings.go stays under the 350-line cap and the obsidian field semantics live in
// one place.

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// GetByObsidianSourcePath — during Obsidian import, finds an already-imported row by its
// vault-relative path; a hit means a re-import, a miss means a new row.
func (r *WritingRepo) GetByObsidianSourcePath(
	ctx context.Context, ownerID, sourcePath string,
) (entity.Writing, error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return entity.Writing{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	row, err := db.New(r.pool).GetWritingByObsidianSourcePath(ctx,
		db.GetWritingByObsidianSourcePathParams{
			OwnerID: ownerUUID, ObsidianSourcePath: sourcePath,
		})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Writing{}, entity.ErrWritingNotFound
		}
		return entity.Writing{}, fmt.Errorf("get writing by obsidian path: %w", err)
	}
	return toDomainWriting(&row), nil
}

// SetObsidianMeta — called after a successful SaveWriting during Obsidian import: marks
// this writing row as coming from the vault (source_path), imported_at = now(). On the
// next re-import, updated_at vs imported_at decides whether the owner overwrote it on
// the web.
func (r *WritingRepo) SetObsidianMeta(
	ctx context.Context, ownerID, writingID, sourcePath string,
) error {
	args, perr := parseOwnerAndWritingID(ownerID, writingID)
	if perr != nil {
		return perr
	}
	if err := db.New(r.pool).SetWritingObsidianMeta(ctx, db.SetWritingObsidianMetaParams{
		ID: args.writingUUID, OwnerID: args.ownerUUID, ObsidianSourcePath: sourcePath,
	}); err != nil {
		return fmt.Errorf("set obsidian meta: %w", err)
	}
	return nil
}
