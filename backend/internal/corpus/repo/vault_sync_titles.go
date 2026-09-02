// vault_sync_titles.go —— reconcile's third identity problem: "does this title point at the
// right note?"
//
// GetByTitle is the cross-genre claim path, and it falls back to `ORDER BY created_at ASC
// LIMIT 1` — once a title isn't unique in the corpus, which row it claims is a coin flip, and
// the loser is often a same-named note in another genre that this upload never even mentioned.
// So before sync acts, it asks the corpus which titles are ambiguous (F-L-61).

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// DuplicateTitles —— titles that occur more than once in the owner's corpus (lowercased,
// cross-genre). An empty slice = every title is unique.
func (r *VaultSyncRepo) DuplicateTitles(ctx context.Context, ownerID string) ([]string, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	titles, qerr := db.New(r.pool).ListDuplicateNoteTitles(ctx, owner)
	if qerr != nil {
		return nil, fmt.Errorf("list duplicate note titles: %w", qerr)
	}
	return titles, nil
}

// GetByTitleInGenre —— claims by title **within this one genre**. Structural nodes (folder
// placeholders) use this path: they have no source_path, so their identity IS "that folder in
// their own tree." No match → ErrSyncNoteNotFound.
func (r *VaultSyncRepo) GetByTitleInGenre(
	ctx context.Context, ownerID, genre, title string,
) (SyncNote, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return SyncNote{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	row, qerr := db.New(r.pool).GetNoteByTitleInGenre(ctx, db.GetNoteByTitleInGenreParams{
		OwnerID: owner, Genre: genre, Title: title,
	})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return SyncNote{}, ErrSyncNoteNotFound
		}
		return SyncNote{}, fmt.Errorf("get note by title in genre: %w", qerr)
	}
	return syncNoteFromRow(&row), nil
}
