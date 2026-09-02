// output.go —— OutputRepo: CRUD + path induce over genre='output' rows in the unified
// corpus_notes table. Isomorphic to WikiRepo (both bind to their own genre and call the same
// set of db.Note* methods). output is the most refined of the raw → wiki → output three
// layers, semantically "quotable as-is"; source_ids records which wikis it was distilled from.

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

// OutputRepo —— CRUD + path induce over corpus_notes(genre='output').
type OutputRepo struct {
	pool *pgstore.Pool
}

// NewOutputRepo constructs an OutputRepo.
func NewOutputRepo(pool *pgstore.Pool) *OutputRepo { return &OutputRepo{pool: pool} }

// CreateOutputInput —— Create's input. SourceWikiIDs records which wikis it was distilled from.
type CreateOutputInput struct {
	OwnerID  string
	Title    string
	Body     string
	ParentID *string
	// ShowAsSource —— nil = quotable (default). See the same-named field on CreateWikiInput.
	ShowAsSource  *bool
	Tags          []string
	SourceWikiIDs []string
}

// Create writes a new output row.
func (r *OutputRepo) Create(
	ctx context.Context, in *CreateOutputInput,
) (entity.Output, error) {
	params, err := buildOutputCreateParams(in)
	if err != nil {
		return entity.Output{}, err
	}
	q := db.New(r.pool)
	row, qerr := q.CreateNote(ctx, params)
	if qerr != nil {
		return entity.Output{}, fmt.Errorf("create output: %w", qerr)
	}
	return toDomainOutput(&row), nil
}

func buildOutputCreateParams(in *CreateOutputInput) (db.CreateNoteParams, error) {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return db.CreateNoteParams{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	parent, err := pgstore.ParseOptionalUUID(in.ParentID)
	if err != nil {
		return db.CreateNoteParams{}, fmt.Errorf("parse parent id: %w", err)
	}
	sourceWikis, err := pgstore.ParseUUIDArray(in.SourceWikiIDs)
	if err != nil {
		return db.CreateNoteParams{}, fmt.Errorf("parse source wiki ids: %w", err)
	}
	return db.CreateNoteParams{
		OwnerID:   ownerUUID,
		Genre:     genreOutput,
		ParentID:  parent,
		Title:     in.Title,
		Body:      in.Body,
		Tags:      nilSafeTags(in.Tags),
		SourceIds: sourceWikis,
		// output create carries no cssclasses (column NOT NULL, must be non-nil).
		CssClasses: []string{},
		// output mirrors wiki: created as a quotable source by default; hiding is the exception
		// path via a later UpdateOutput. Without an explicit true, the zero value false gets
		// written → the readCollector gate mistakes it for a hidden entry and drops all citation.
		ShowAsSource: citableUnlessHidden(in.ShowAsSource),
	}, nil
}

// ListByOwner returns the owner's outputs (the newest N).
func (r *OutputRepo) ListByOwner(
	ctx context.Context, ownerID string, limit int32,
) ([]entity.Output, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	q := db.New(r.pool)
	rows, err := q.ListNotesByOwner(ctx, db.ListNotesByOwnerParams{
		OwnerID: ownerUUID, Genre: genreOutput, Limit: limit,
	})
	if err != nil {
		return nil, fmt.Errorf("list output: %w", err)
	}
	out := make([]entity.Output, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainOutput(&rows[i]))
	}
	return out, nil
}

// GetByID fetches one of the owner's outputs; no match returns ErrOutputNotFound.
func (r *OutputRepo) GetByID(
	ctx context.Context, ownerID, id string,
) (entity.Output, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return entity.Output{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	outputUUID, err := pgstore.ParseUUID(id)
	if err != nil {
		return entity.Output{}, fmt.Errorf("parse output id: %w", err)
	}
	q := db.New(r.pool)
	row, err := q.GetNoteByID(ctx, db.GetNoteByIDParams{
		ID: outputUUID, OwnerID: ownerUUID, Genre: genreOutput,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Output{}, entity.ErrOutputNotFound
		}
		return entity.Output{}, fmt.Errorf("get output: %w", err)
	}
	return toDomainOutput(&row), nil
}

// OutputMeta —— output's meta (no body): used by lazy-load search/read paths, mirrors WikiMeta.
// UpdatedAt is only filled by ListAllMeta (sitemap); other paths leave it 0.
type OutputMeta struct {
	ParentID    *string
	ID          string
	Title       string
	Snippet     string
	UpdatedAt   int64
	Published   bool
	HasChildren bool
}

// ListChildren —— an output node's direct children (meta only, no body); parentID nil = root
// level; paginated. Mirrors WikiRepo.ListChildren — output is isomorphic to wiki, and drilling
// down by path relies on this.
func (r *OutputRepo) ListChildren(
	ctx context.Context, ownerID string, parentID *string, limit, offset int32,
) ([]OutputMeta, error) {
	return listChildrenMeta(ownerID, parentID,
		func(o, p pgtype.UUID) ([]db.ListNoteChildrenRow, error) {
			return db.New(r.pool).ListNoteChildren(ctx, db.ListNoteChildrenParams{
				OwnerID: o, Genre: genreOutput, Column3: p, Limit: limit, Offset: offset,
			})
		},
		func(row db.ListNoteChildrenRow) OutputMeta {
			return OutputMeta{
				ID: pgstore.FormatUUID(row.ID), ParentID: pgstore.OptUUIDStr(row.ParentID),
				Title: row.Title, Published: row.Published, HasChildren: row.HasChildren,
			}
		})
}

// GetMetaByID —— output meta (no body): used to walk up and compute path / evaluate ACL.
// No match → ErrOutputNotFound.
func (r *OutputRepo) GetMetaByID(ctx context.Context, ownerID, id string) (OutputMeta, error) {
	ids, perr := parseSrcAndOwner(id, ownerID)
	if perr != nil {
		return OutputMeta{}, perr
	}
	row, err := db.New(r.pool).GetNoteMetaByID(ctx, db.GetNoteMetaByIDParams{
		ID: ids.Src, OwnerID: ids.Owner, Genre: genreOutput,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return OutputMeta{}, entity.ErrOutputNotFound
		}
		return OutputMeta{}, fmt.Errorf("get output meta: %w", err)
	}
	return OutputMeta{
		ID: pgstore.FormatUUID(row.ID), ParentID: pgstore.OptUUIDStr(row.ParentID),
		Title: row.Title, Published: row.Published,
	}, nil
}

// Search —— full-text keyword search on the DB side; returns meta + snippet (no full body);
// paginated.
func (r *OutputRepo) Search(
	ctx context.Context, ownerID, query string, limit, offset int32,
) ([]OutputMeta, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, qerr := db.New(r.pool).SearchNotes(ctx, db.SearchNotesParams{
		OwnerID: ownerUUID, Genre: genreOutput,
		PlaintoTsquery: query, Limit: limit, Offset: offset,
	})
	if qerr != nil {
		return nil, fmt.Errorf("search output: %w", qerr)
	}
	out := make([]OutputMeta, 0, len(rows))
	for i := range rows {
		out = append(out, outputSearchRowMeta(&rows[i]))
	}
	return out, nil
}

func outputSearchRowMeta(row *db.SearchNotesRow) OutputMeta {
	return OutputMeta{
		ID: pgstore.FormatUUID(row.ID), ParentID: pgstore.OptUUIDStr(row.ParentID),
		Title: row.Title, Published: row.Published, Snippet: string(row.Snippet),
		UpdatedAt: row.UpdatedAt.Time.Unix(),
	}
}

// ListAllMeta —— every meta row (no body, no limit): used by the sitemap to enumerate every
// indexed output.
func (r *OutputRepo) ListAllMeta(ctx context.Context, ownerID string) ([]OutputMeta, error) {
	mk := func(row *db.ListAllNoteMetaRow) OutputMeta {
		return OutputMeta{
			ID: pgstore.FormatUUID(row.ID), ParentID: pgstore.OptUUIDStr(row.ParentID),
			Title: row.Title, Published: row.Published,
			UpdatedAt: row.UpdatedAt.Time.Unix(),
		}
	}
	return listNoteMetaBy(ctx, r.pool, ownerID, genreOutput, mk)
}

func toDomainOutput(o *db.CorpusNote) entity.Output {
	in := entity.OutputInit{
		ID:            pgstore.FormatUUID(o.ID),
		OwnerID:       pgstore.FormatUUID(o.OwnerID),
		Title:         o.Title,
		Body:          o.Body,
		Tags:          o.Tags,
		SourceWikiIDs: pgstore.FormatUUIDList(o.SourceIds),
		ShowAsSource:  o.ShowAsSource,
		Excerpt:       o.Excerpt,
		Published:     o.Published,
		CreatedAt:     o.CreatedAt.Time,
		UpdatedAt:     o.UpdatedAt.Time,
		Integrations:  connector.NewIntegrations(),
	}
	if o.ParentID.Valid {
		s := pgstore.FormatUUID(o.ParentID)
		in.ParentID = &s
	}
	return entity.NewOutput(&in)
}
