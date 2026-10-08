// microsite_trash.go —— the microsite trash: a delete sets status='deleted' (Delete); these list,
// restore and purge.

package repo

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// Trash —— the owner's deleted pages, newest delete first.
func (r *MicrositeRepo) Trash(
	ctx context.Context, ownerID string,
) ([]entity.TrashedMicrosite, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerID, err)
	}
	rows, err := db.New(r.pool).ListTrashedMicrosites(ctx, owner)
	if err != nil {
		return nil, fmt.Errorf("list trashed microsites: %w", err)
	}
	out := make([]entity.TrashedMicrosite, 0, len(rows))
	for i := range rows {
		out = append(out, entity.TrashedMicrosite{
			ID: pgstore.FormatUUID(rows[i].ID), Slug: rows[i].Slug, Title: rows[i].Title,
			DeletedAt: rows[i].DeletedAt.Time,
		})
	}
	return out, nil
}

// RestoreTrashed —— takes a page out of the trash by id (Restore is the home singleton's
// get-or-restore by slug). ErrMicrositeNotInTrash when it is not there; a SlugTakenError when a
// live page took its slug since.
func (r *MicrositeRepo) RestoreTrashed(ctx context.Context, ownerID, pageID string) error {
	page, err := r.trashedPage(ctx, ownerID, pageID)
	if err != nil {
		return err
	}
	_, err = db.New(r.pool).RestoreTrashedMicrosite(ctx, db.RestoreTrashedMicrositeParams(page.key))
	if _, taken := pgstore.UniqueViolation(err); taken {
		return &entity.SlugTakenError{Slug: page.slug}
	}
	if err != nil {
		return fmt.Errorf("restore microsite: %w", err)
	}
	return nil
}

// trashedRow —— a trashed page's key, and its slug (a restore refusal names it).
type trashedRow struct {
	slug string
	key  db.GetTrashedMicrositeSlugParams
}

func (r *MicrositeRepo) trashedPage(
	ctx context.Context, ownerID, pageID string,
) (trashedRow, error) {
	owner, oerr := pgstore.ParseUUID(ownerID)
	id, ierr := pgstore.ParseUUID(pageID)
	row := trashedRow{key: db.GetTrashedMicrositeSlugParams{ID: id, OwnerID: owner}}
	if oerr != nil || ierr != nil {
		return row, entity.ErrMicrositeNotInTrash
	}
	slug, err := db.New(r.pool).GetTrashedMicrositeSlug(ctx, row.key)
	if errors.Is(err, pgx.ErrNoRows) {
		return row, entity.ErrMicrositeNotInTrash
	}
	if err != nil {
		return row, fmt.Errorf("read trashed microsite: %w", err)
	}
	row.slug = slug
	return row, nil
}

// ExpiredTrash —— the ids of pages deleted before cutoff.
func (r *MicrositeRepo) ExpiredTrash(ctx context.Context, cutoff time.Time) ([]string, error) {
	before := pgtype.Timestamptz{Time: cutoff, Valid: true}
	rows, err := db.New(r.pool).ExpiredTrashedMicrosites(ctx, before)
	if err != nil {
		return nil, fmt.Errorf("list expired trashed microsites: %w", err)
	}
	out := make([]string, 0, len(rows))
	for _, id := range rows {
		out = append(out, pgstore.FormatUUID(id))
	}
	return out, nil
}

// Purge —— removes one trashed page row; its builds cascade.
func (r *MicrositeRepo) Purge(ctx context.Context, pageID string) error {
	id, err := pgstore.ParseUUID(pageID)
	if err != nil {
		return fmt.Errorf(errParsePageID, err)
	}
	if _, perr := db.New(r.pool).PurgeTrashedMicrosite(ctx, id); perr != nil {
		return fmt.Errorf("purge microsite: %w", perr)
	}
	return nil
}
