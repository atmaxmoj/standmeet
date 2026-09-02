// writing_refs.go —— CRUD for the `[[crosslink]]` edge table.
//
// SaveWriting calls ReplaceRefsBySrcTx in the same transaction to rebuild the src's out-degree
// (delete old + insert new); the public /writings GET calls BacklinksFor to look up in-degree.
// FK cascade guarantees a deleted writing's edges vanish automatically.

package repo

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// WritingRefRepo —— CRUD for the writing_refs table.
type WritingRefRepo struct {
	pool *pgstore.Pool
}

// NewWritingRefRepo constructs one.
func NewWritingRefRepo(pool *pgstore.Pool) *WritingRefRepo { return &WritingRefRepo{pool: pool} }

// WritingRef —— one backlink / outbound ref return value (slug + title).
type WritingRef struct {
	Slug  string
	Title string
}

// srcOwnerUUIDs —— packs parseSrcAndOwner's return to avoid the Go result-count limit.
type srcOwnerUUIDs struct {
	Src, Owner pgtype.UUID
}

// ReplaceRefsBySrcTx —— rebuilds src writing's out-degree via delete + insert. Called within
// the same tx as SaveWriting, committed together with the writing row update. dstIDs must
// already be deduplicated (caller's responsibility).
func (*WritingRefRepo) ReplaceRefsBySrcTx(
	ctx context.Context, tx db.DBTX,
	srcID, ownerID string, dstIDs []string,
) error {
	ids, perr := parseSrcAndOwner(srcID, ownerID)
	if perr != nil {
		return perr
	}
	q := db.New(tx)
	if derr := q.DeleteRefsBySrc(ctx, ids.Src); derr != nil {
		return fmt.Errorf("delete old refs: %w", derr)
	}
	return insertNewRefs(ctx, q, ids.Src, ids.Owner, dstIDs)
}

func parseSrcAndOwner(srcID, ownerID string) (srcOwnerUUIDs, error) {
	srcUUID, perr := pgstore.ParseUUID(srcID)
	if perr != nil {
		return srcOwnerUUIDs{}, fmt.Errorf("parse src id: %w", perr)
	}
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return srcOwnerUUIDs{}, fmt.Errorf("parse owner id: %w", oerr)
	}
	return srcOwnerUUIDs{Src: srcUUID, Owner: ownerUUID}, nil
}

func insertNewRefs(
	ctx context.Context, q *db.Queries,
	srcUUID, ownerUUID pgtype.UUID, dstIDs []string,
) error {
	for _, dstID := range dstIDs {
		if err := insertOneRef(ctx, q, srcUUID, ownerUUID, dstID); err != nil {
			return err
		}
	}
	return nil
}

func insertOneRef(
	ctx context.Context, q *db.Queries,
	srcUUID, ownerUUID pgtype.UUID, dstID string,
) error {
	dstUUID, derr := pgstore.ParseUUID(dstID)
	if derr != nil {
		return fmt.Errorf("parse dst id %s: %w", dstID, derr)
	}
	if err := q.InsertWritingRef(ctx, db.InsertWritingRefParams{
		SrcWritingID: srcUUID, DstWritingID: dstUUID, OwnerID: ownerUUID,
	}); err != nil {
		return fmt.Errorf("insert ref: %w", err)
	}
	return nil
}

// BacklinksFor —— lists every (source writing slug, source writing title) pointing at dstID.
// Only lists source writings that are already published (a visitor never sees a draft backlink).
func (r *WritingRefRepo) BacklinksFor(
	ctx context.Context, ownerID, dstID string,
) ([]WritingRef, error) {
	dstUUID, derr := pgstore.ParseUUID(dstID)
	if derr != nil {
		return nil, fmt.Errorf("parse dst id: %w", derr)
	}
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return nil, fmt.Errorf("parse owner id: %w", oerr)
	}
	rows, err := db.New(r.pool).ListBacklinksForWriting(ctx, db.ListBacklinksForWritingParams{
		DstWritingID: dstUUID, OwnerID: ownerUUID,
	})
	if err != nil {
		return nil, fmt.Errorf("list backlinks: %w", err)
	}
	return mapRefs(rows), nil
}

func mapRefs(rows []db.ListBacklinksForWritingRow) []WritingRef {
	out := make([]WritingRef, 0, len(rows))
	for i := range rows {
		out = append(out, WritingRef{Slug: rows[i].Slug, Title: rows[i].Title})
	}
	return out
}
