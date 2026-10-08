// corpus_trash.go —— the corpus trash (migrations/2026-10-08-corpus-trash.sql). Triggers fill it on
// every delete path; this reads it, restores from it and purges it.

package repo

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// The SQLSTATEs corpus_trash_restore raises (see the migration).
const (
	trashNotFoundSQLState      = "SMT01"
	trashParentTrashedSQLState = "SMT02"
)

// TrashRepo —— reads and writes corpus_trash.
type TrashRepo struct {
	pool *pgstore.Pool
}

// NewTrashRepo constructs one.
func NewTrashRepo(pool *pgstore.Pool) *TrashRepo { return &TrashRepo{pool: pool} }

// Trash —— the trash on the same pool. The trash also holds this repo's edges (a link edge waits
// there with its note), and reaching it from here keeps corpus Deps under the hugeParam size.
func (r *NoteRefRepo) Trash() *TrashRepo { return &TrashRepo{pool: r.pool} }

// TrashItem —— one trashed root and how many descendants went with it.
type TrashItem struct {
	DeletedAt   time.Time
	ID          string
	Genre       string
	Title       string
	Descendants int64
}

// List —— the owner's trashed roots, newest first.
func (r *TrashRepo) List(ctx context.Context, ownerID string) ([]TrashItem, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, err := db.New(r.pool).ListCorpusTrash(ctx, owner)
	if err != nil {
		return nil, fmt.Errorf("list corpus trash: %w", err)
	}
	out := make([]TrashItem, 0, len(rows))
	for i := range rows {
		out = append(out, TrashItem{
			ID: pgstore.FormatUUID(rows[i].NoteID), Genre: rows[i].Genre, Title: rows[i].Title,
			DeletedAt: rows[i].DeletedAt.Time, Descendants: rows[i].Descendants,
		})
	}
	return out, nil
}

// Restore —— puts the entry, the descendants deleted with it and their link edges back. Returns
// the restored ids, root first.
func (r *TrashRepo) Restore(ctx context.Context, ownerID, noteID string) ([]string, error) {
	ids, perr := parseSrcAndOwner(noteID, ownerID)
	if perr != nil {
		return nil, perr
	}
	rows, err := db.New(r.pool).RestoreFromCorpusTrash(ctx, db.RestoreFromCorpusTrashParams{
		OwnerID: ids.Owner, NoteID: ids.Src,
	})
	if err != nil {
		return nil, restoreErr(err)
	}
	out := make([]string, 0, len(rows))
	for _, id := range rows {
		out = append(out, pgstore.FormatUUID(id))
	}
	return out, nil
}

// restoreErr —— the restore function's own SQLSTATEs become the domain's errors.
func restoreErr(err error) error {
	if _, taken := pgstore.UniqueViolation(err); taken {
		return entity.ErrSiblingSlugTaken
	}
	pgErr, ok := errors.AsType[*pgconn.PgError](err)
	if !ok {
		return fmt.Errorf("restore from corpus trash: %w", err)
	}
	if as, known := restoreRefusals[pgErr.Code]; known {
		return as(pgErr.Message)
	}
	return fmt.Errorf("restore from corpus trash: %w", err)
}

// restoreRefusals —— SQLSTATE → domain error, given the function's message.
var restoreRefusals = map[string]func(msg string) error{
	trashNotFoundSQLState: func(string) error { return entity.ErrNotInTrash },
	trashParentTrashedSQLState: func(msg string) error {
		return &entity.ParentTrashedError{ParentTitle: msg}
	},
}

// Purge —— drops every trash row deleted before cutoff. Returns how many rows went.
func (r *TrashRepo) Purge(ctx context.Context, cutoff time.Time) (int64, error) {
	n, err := db.New(r.pool).PurgeCorpusTrash(ctx, pgtype.Timestamptz{Time: cutoff, Valid: true})
	if err != nil {
		return 0, fmt.Errorf("purge corpus trash: %w", err)
	}
	return n, nil
}
