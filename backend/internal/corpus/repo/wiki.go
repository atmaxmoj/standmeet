// wiki.go — WikiRepo: CRUD + path induction over genre='wiki' on the unified corpus_notes
// table. Isomorphic to OutputRepo (both bind their own genre and call the same set of
// db.Note* methods); path-string lookup shares the loadByPath helper in corpus.go.

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// WikiRepo — CRUD + path induction over corpus_notes(genre='wiki').
type WikiRepo struct {
	pool *pgstore.Pool
}

// NewWikiRepo constructs a WikiRepo.
func NewWikiRepo(pool *pgstore.Pool) *WikiRepo { return &WikiRepo{pool: pool} }

// CreateWikiInput is the input to Create.
type CreateWikiInput struct {
	OwnerID  string
	Title    string
	Body     string
	ParentID *string
	// ShowAsSource — nil = citable (default). Only set false when the caller **explicitly**
	// wants it hidden (meta/persona-style entries). The pointer isn't fussiness: a bare bool
	// can't express "not given", and "not given" must stay distinct from "wants it hidden".
	ShowAsSource *bool
	Tags         []string
	SourceRawIDs []string
}

// citableUnlessHidden — citable by default when not given. See CreateWikiInput.ShowAsSource.
func citableUnlessHidden(v *bool) bool { return v == nil || *v }

// Create writes a new wiki entry. Pointer receiver avoids hugeParam.
func (r *WikiRepo) Create(ctx context.Context, in *CreateWikiInput) (entity.Wiki, error) {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return entity.Wiki{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	parent, err := pgstore.ParseOptionalUUID(in.ParentID)
	if err != nil {
		return entity.Wiki{}, fmt.Errorf("parse parent id: %w", err)
	}
	sourceRaws, err := pgstore.ParseUUIDArray(in.SourceRawIDs)
	if err != nil {
		return entity.Wiki{}, fmt.Errorf("parse source raw ids: %w", err)
	}
	q := db.New(r.pool)
	row, err := q.CreateNote(ctx, db.CreateNoteParams{
		OwnerID:   ownerUUID,
		Genre:     genreWiki,
		ParentID:  parent,
		Title:     in.Title,
		Body:      in.Body,
		Tags:      nilSafeTags(in.Tags),
		SourceIds: sourceRaws,
		// wiki create carries no cssclasses (NOT NULL column, must be non-nil).
		CssClasses: []string{},
		// A wiki entry is a citable source by construction; hiding it (meta/persona) is an
		// exception that the caller must **explicitly** request.
		// Not given defaults to true — writing the zero value false would make readCollector's
		// gate mistake it for a hidden entry, and citations would all be lost.
		ShowAsSource: citableUnlessHidden(in.ShowAsSource),
	})
	if err != nil {
		return entity.Wiki{}, fmt.Errorf("create wiki: %w", err)
	}
	return toDomainWiki(&row), nil
}

// ListByOwner returns the owner's wiki entries (newest N).
func (r *WikiRepo) ListByOwner(
	ctx context.Context, ownerID string, limit int32,
) ([]entity.Wiki, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	q := db.New(r.pool)
	rows, err := q.ListNotesByOwner(ctx, db.ListNotesByOwnerParams{
		OwnerID: ownerUUID, Genre: genreWiki, Limit: limit,
	})
	if err != nil {
		return nil, fmt.Errorf("list wiki: %w", err)
	}
	out := make([]entity.Wiki, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainWiki(&rows[i]))
	}
	return out, nil
}

// GetByID fetches a wiki entry belonging to owner; returns ErrWikiNotFound on a miss.
func (r *WikiRepo) GetByID(ctx context.Context, ownerID, id string) (entity.Wiki, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return entity.Wiki{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	wikiUUID, err := pgstore.ParseUUID(id)
	if err != nil {
		return entity.Wiki{}, fmt.Errorf("parse wiki id: %w", err)
	}
	q := db.New(r.pool)
	row, err := q.GetNoteByID(ctx, db.GetNoteByIDParams{
		ID: wikiUUID, OwnerID: ownerUUID, Genre: genreWiki,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Wiki{}, entity.ErrWikiNotFound
		}
		return entity.Wiki{}, fmt.Errorf("get wiki: %w", err)
	}
	return toDomainWiki(&row), nil
}

// WikiMeta — lightweight meta for one wiki entry (**no body**), for lazy-loaded tree
// navigation / search. Reading the body goes through GetByID separately. Snippet is
// populated only in search results.
type WikiMeta struct {
	ParentID    *string
	ID          string
	Title       string
	Snippet     string
	UpdatedAt   int64
	Published   bool
	HasChildren bool
}

// ListChildren — direct children of a node (meta, no body); parentID nil = root level;
// limit/offset paginate.
func (r *WikiRepo) ListChildren(
	ctx context.Context, ownerID string, parentID *string, limit, offset int32,
) ([]WikiMeta, error) {
	return listChildrenMeta(ownerID, parentID,
		func(o, p pgtype.UUID) ([]db.ListNoteChildrenRow, error) {
			return db.New(r.pool).ListNoteChildren(ctx, db.ListNoteChildrenParams{
				OwnerID: o, Genre: genreWiki, Column3: p, Limit: limit, Offset: offset,
			})
		},
		func(row db.ListNoteChildrenRow) WikiMeta {
			return WikiMeta{
				ID: pgstore.FormatUUID(row.ID), ParentID: pgstore.OptUUIDStr(row.ParentID),
				Title: row.Title, Published: row.Published, HasChildren: row.HasChildren,
			}
		})
}

// GetMetaByID — meta for one wiki entry (no body): used to walk up and compute path /
// check ACL. Miss → ErrWikiNotFound.
func (r *WikiRepo) GetMetaByID(ctx context.Context, ownerID, id string) (WikiMeta, error) {
	ids, perr := parseSrcAndOwner(id, ownerID)
	if perr != nil {
		return WikiMeta{}, perr
	}
	row, err := db.New(r.pool).GetNoteMetaByID(ctx, db.GetNoteMetaByIDParams{
		ID: ids.Src, OwnerID: ids.Owner, Genre: genreWiki,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return WikiMeta{}, entity.ErrWikiNotFound
		}
		return WikiMeta{}, fmt.Errorf("get wiki meta: %w", err)
	}
	return WikiMeta{
		ID: pgstore.FormatUUID(row.ID), ParentID: pgstore.OptUUIDStr(row.ParentID),
		Title: row.Title, Published: row.Published,
	}, nil
}

// Search — full DB-side keyword search (full-text); returns meta + snippet
// (no full body); paginated.
func (r *WikiRepo) Search(
	ctx context.Context, ownerID, query string, limit, offset int32,
) ([]WikiMeta, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, qerr := db.New(r.pool).SearchNotes(ctx, db.SearchNotesParams{
		OwnerID: ownerUUID, Genre: genreWiki, PlaintoTsquery: query, Limit: limit, Offset: offset,
	})
	if qerr != nil {
		return nil, fmt.Errorf("search wiki: %w", qerr)
	}
	out := make([]WikiMeta, 0, len(rows))
	for i := range rows {
		out = append(out, wikiSearchRowMeta(&rows[i]))
	}
	return out, nil
}

func wikiSearchRowMeta(row *db.SearchNotesRow) WikiMeta {
	return WikiMeta{
		ID: pgstore.FormatUUID(row.ID), ParentID: pgstore.OptUUIDStr(row.ParentID),
		Title: row.Title, Published: row.Published, Snippet: string(row.Snippet),
		UpdatedAt: row.UpdatedAt.Time.Unix(),
	}
}

// WikiStats — sidebar footer counts (pure aggregation, doesn't load the tree).
type WikiStats struct {
	Entries int
	Roots   int
	Gated   int
}

// CountStats — owner's total wiki count / root count / non-public (gated) count.
// A single COUNT query, zero memory.
func (r *WikiRepo) CountStats(ctx context.Context, ownerID string) (WikiStats, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return WikiStats{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	row, qerr := db.New(r.pool).CountNoteStats(ctx, db.CountNoteStatsParams{
		OwnerID: ownerUUID, Genre: genreWiki,
	})
	if qerr != nil {
		return WikiStats{}, fmt.Errorf("count wiki stats: %w", qerr)
	}
	return WikiStats{Entries: int(row.Entries), Roots: int(row.Roots), Gated: int(row.Gated)}, nil
}

// ListAllMeta — full meta set (no body, no limit): used to enumerate every indexed entry
// for the sitemap plus the landing page's [[X]] title→path index. No newest-N cap.
func (r *WikiRepo) ListAllMeta(ctx context.Context, ownerID string) ([]WikiMeta, error) {
	mk := func(row *db.ListAllNoteMetaRow) WikiMeta {
		return WikiMeta{
			ID: pgstore.FormatUUID(row.ID), ParentID: pgstore.OptUUIDStr(row.ParentID),
			Title: row.Title, Published: row.Published,
			UpdatedAt: row.UpdatedAt.Time.Unix(),
		}
	}
	return listNoteMetaBy(ctx, r.pool, ownerID, genreWiki, mk)
}

func toDomainWiki(w *db.CorpusNote) entity.Wiki {
	in := entity.WikiInit{
		ID:           pgstore.FormatUUID(w.ID),
		OwnerID:      pgstore.FormatUUID(w.OwnerID),
		Title:        w.Title,
		Body:         w.Body,
		Tags:         w.Tags,
		CSSClasses:   w.CssClasses,
		SourceRawIDs: pgstore.FormatUUIDList(w.SourceIds),
		ShowAsSource: w.ShowAsSource,
		Excerpt:      w.Excerpt,
		Published:    w.Published,
		CreatedAt:    w.CreatedAt.Time,
		UpdatedAt:    w.UpdatedAt.Time,
		Integrations: connector.NewIntegrations(),
	}
	if w.ParentID.Valid {
		s := pgstore.FormatUUID(w.ParentID)
		in.ParentID = &s
	}
	return entity.NewWiki(&in)
}
