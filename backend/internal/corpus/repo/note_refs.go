// note_refs.go — CRUD over the corpus `[[Title]]` backlink edge table (mirrors
// writing_refs, but wiki has no slug: edges are stored by wiki.id, returned as
// id + title, and path is computed by the usecase via WikiTreePaths).
//
// PromoteToWiki / UpdateWiki call ReplaceRefsBySrcTx in the same transaction to
// rebuild src's out-degree; the public landing page calls BacklinksFor (in-degree
// = cited by) + OutboundFor (out-degree = read next/sources).

package repo

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// NoteRefRepo — CRUD over the note_refs table.
type NoteRefRepo struct {
	pool *pgstore.Pool
}

// NewNoteRefRepo constructs one.
func NewNoteRefRepo(pool *pgstore.Pool) *NoteRefRepo { return &NoteRefRepo{pool: pool} }

// NoteRef — one backlink / outbound ref (the target note's id + title). Path is
// derived by the caller from the whole tree (a wiki address is a tree path, not stored).
type NoteRef struct {
	ID    string
	Title string
}

// ReplaceRefsBySrcTx — delete + insert to rebuild a src wiki's out-degree. Called
// within the same tx that writes the wiki row. dstIDs must already be deduped and
// exclude self-links (the caller's responsibility).
func (*NoteRefRepo) ReplaceRefsBySrcTx(
	ctx context.Context, tx db.DBTX,
	srcID, ownerID string, dstIDs []string,
) error {
	ids, perr := parseSrcAndOwner(srcID, ownerID)
	if perr != nil {
		return perr
	}
	q := db.New(tx)
	if derr := q.DeleteNoteRefsBySrc(ctx, ids.Src); derr != nil {
		return fmt.Errorf("delete old wiki refs: %w", derr)
	}
	return insertNewNoteRefs(ctx, q, ids.Src, ids.Owner, dstIDs)
}

// ReplaceRefsBySrc — the non-transactional version (the wiki write path isn't in
// a tx). The edge table is a derived index, so delete + insert can go straight
// through the pool (*pgstore.Pool satisfies db.DBTX) with no atomicity requirement.
// The caller has already deduped and excluded self-links.
func (r *NoteRefRepo) ReplaceRefsBySrc(
	ctx context.Context, srcID, ownerID string, dstIDs []string,
) error {
	return r.ReplaceRefsBySrcTx(ctx, r.pool, srcID, ownerID, dstIDs)
}

func insertNewNoteRefs(
	ctx context.Context, q *db.Queries,
	srcUUID, ownerUUID pgtype.UUID, dstIDs []string,
) error {
	for _, dstID := range dstIDs {
		if err := insertOneNoteRef(ctx, q, srcUUID, ownerUUID, dstID); err != nil {
			return err
		}
	}
	return nil
}

func insertOneNoteRef(
	ctx context.Context, q *db.Queries,
	srcUUID, ownerUUID pgtype.UUID, dstID string,
) error {
	dstUUID, derr := pgstore.ParseUUID(dstID)
	if derr != nil {
		return fmt.Errorf("parse dst id %s: %w", dstID, derr)
	}
	if err := q.InsertNoteRef(ctx, db.InsertNoteRefParams{
		SrcID: srcUUID, DstID: dstUUID, OwnerID: ownerUUID,
	}); err != nil {
		return fmt.Errorf("insert wiki ref: %w", err)
	}
	return nil
}

// BacklinksFor — "cited by": lists the source wikis that point to dstID
// (id + title), published only.
func (r *NoteRefRepo) BacklinksFor(
	ctx context.Context, ownerID, dstID string,
) ([]NoteRef, error) {
	ids, perr := parseSrcAndOwner(dstID, ownerID)
	if perr != nil {
		return nil, perr
	}
	rows, err := db.New(r.pool).ListWikiBacklinks(ctx, db.ListWikiBacklinksParams{
		DstID: ids.Src, OwnerID: ids.Owner,
	})
	if err != nil {
		return nil, fmt.Errorf("list wiki backlinks: %w", err)
	}
	out := make([]NoteRef, 0, len(rows))
	for i := range rows {
		out = append(out, NoteRef{ID: pgstore.FormatUUID(rows[i].ID), Title: rows[i].Title})
	}
	return out, nil
}

// AdminBacklinksFor — owner-view "cited by": which notes reference dst
// (any genre, including unpublished).
func (r *NoteRefRepo) AdminBacklinksFor(
	ctx context.Context, ownerID, dstID string,
) ([]NoteRef, error) {
	ids, perr := parseSrcAndOwner(dstID, ownerID)
	if perr != nil {
		return nil, perr
	}
	rows, err := db.New(r.pool).ListNoteBacklinksAll(ctx, db.ListNoteBacklinksAllParams{
		DstID: ids.Src, OwnerID: ids.Owner,
	})
	if err != nil {
		return nil, fmt.Errorf("list note backlinks: %w", err)
	}
	out := make([]NoteRef, 0, len(rows))
	for i := range rows {
		out = append(out, NoteRef{ID: pgstore.FormatUUID(rows[i].ID), Title: rows[i].Title})
	}
	return out, nil
}

// AdminOutboundFor — owner-view "read next": which notes src references
// (any genre, including unpublished).
func (r *NoteRefRepo) AdminOutboundFor(
	ctx context.Context, ownerID, srcID string,
) ([]NoteRef, error) {
	ids, perr := parseSrcAndOwner(srcID, ownerID)
	if perr != nil {
		return nil, perr
	}
	rows, err := db.New(r.pool).ListNoteOutboundAll(ctx, db.ListNoteOutboundAllParams{
		SrcID: ids.Src, OwnerID: ids.Owner,
	})
	if err != nil {
		return nil, fmt.Errorf("list note outbound: %w", err)
	}
	out := make([]NoteRef, 0, len(rows))
	for i := range rows {
		out = append(out, NoteRef{ID: pgstore.FormatUUID(rows[i].ID), Title: rows[i].Title})
	}
	return out, nil
}

// OwnerNoteTitleRow — a cross-genre title→id (+genre) index entry, for [[link]] resolution.
type OwnerNoteTitleRow struct {
	ID    string
	Title string
	Genre string
	// Aliases — this note's alias pool (frontmatter `aliases:`). `[[alias]]` resolves to
	// this entry the same way `[[Title]]` does — **same candidate pool, same disambiguation**
	// (pickByProximity). Aliases don't carry a second ranking rule.
	Aliases []string
}

// OwnerNoteTitles — the owner's full corpus (cross-genre) title/id set, for
// note refs to resolve `[[Title]]`.
func (r *NoteRefRepo) OwnerNoteTitles(
	ctx context.Context, ownerID string,
) ([]OwnerNoteTitleRow, error) {
	ownerUUID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, perr)
	}
	rows, err := db.New(r.pool).ListAllOwnerNoteTitles(ctx, ownerUUID)
	if err != nil {
		return nil, fmt.Errorf("list owner note titles: %w", err)
	}
	out := make([]OwnerNoteTitleRow, 0, len(rows))
	for i := range rows {
		out = append(out, OwnerNoteTitleRow{
			ID: pgstore.FormatUUID(rows[i].ID), Title: rows[i].Title, Genre: rows[i].Genre,
			Aliases: rows[i].Aliases,
		})
	}
	return out, nil
}

// OutboundFor — "read next / sources": which wikis src references (id + title),
// published only. "N corpus sources" = len(returned).
func (r *NoteRefRepo) OutboundFor(
	ctx context.Context, srcID string,
) ([]NoteRef, error) {
	srcUUID, perr := pgstore.ParseUUID(srcID)
	if perr != nil {
		return nil, fmt.Errorf("parse src id: %w", perr)
	}
	rows, err := db.New(r.pool).ListWikiOutbound(ctx, srcUUID)
	if err != nil {
		return nil, fmt.Errorf("list wiki outbound: %w", err)
	}
	out := make([]NoteRef, 0, len(rows))
	for i := range rows {
		out = append(out, NoteRef{ID: pgstore.FormatUUID(rows[i].ID), Title: rows[i].Title})
	}
	return out, nil
}
