// note.go — NoteRepo: a genre-parameterized generic corpus_notes repository. One instance
// binds one genre (passed at construction) and reuses the shared db.Note* queries.
// subjectivity uses it directly (zero duplication); wiki/output currently have their own
// repos and can converge onto this one later.
//
// Exposes only the generic tree-note surface (create/read/meta/children/search/reparent/
// delete), no genre-specific fields (source_ids, covers, ...) — those stay in each genre's
// thin wrapper. The address is still purely derived from the tree (the parent chain).

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// ErrNoteNotFound — the genre-generic not-found error.
var ErrNoteNotFound = errors.New("note not found")

// NoteRepo — a generic note repository bound to a single genre.
type NoteRepo struct {
	pool  *pgstore.Pool
	genre string
}

// NewNoteRepo constructs a NoteRepo bound to the given genre.
func NewNoteRepo(pool *pgstore.Pool, genre string) *NoteRepo {
	return &NoteRepo{pool: pool, genre: genre}
}

// Genre returns the genre this repo is bound to.
func (r *NoteRepo) Genre() string { return r.genre }

// Note — a generic view of one note (no genre-specific fields). ShowAsSource decides
// whether it enters the visitor's cited footer (subjectivity defaults to false = private;
// wiki/output default to true).
type Note struct {
	ParentID     *string
	ID           string
	OwnerID      string
	Title        string
	Body         string
	Tags         []string
	ShowAsSource bool
	// Published — this note's own public/private switch. The read path must carry it along:
	// whether a public identity can read this note comes down to this one value (see
	// access.AllowsCorpusEntry). The row was already selected; this just stops discarding it.
	Published bool
}

// NoteMeta — lightweight meta with no body (for tree navigation / search / computing path).
// Snippet is populated only in search results. Same for UpdatedAt (unix seconds; 0 = this
// path didn't fetch it).
type NoteMeta struct {
	ParentID    *string
	ID          string
	Title       string
	Snippet     string
	UpdatedAt   int64
	Published   bool
	HasChildren bool
}

// CreateNoteInput — creates one note. ShowAsSource: whether it enters the visitor cited
// footer. subjectivity passes false by default (private); the caller sets it explicitly.
type CreateNoteInput struct {
	OwnerID      string
	ParentID     *string
	Title        string
	Body         string
	Tags         []string
	CSSClasses   []string
	ShowAsSource bool
}

// Create writes a new note (in this repo's genre).
func (r *NoteRepo) Create(ctx context.Context, in *CreateNoteInput) (Note, error) {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return Note{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	parent, err := pgstore.ParseOptionalUUID(in.ParentID)
	if err != nil {
		return Note{}, fmt.Errorf("parse parent id: %w", err)
	}
	row, err := db.New(r.pool).CreateNote(ctx, db.CreateNoteParams{
		OwnerID: ownerUUID, Genre: r.genre, ParentID: parent,
		Title: in.Title, Body: in.Body, Tags: nilSafeTags(in.Tags),
		CssClasses: nilSafeTags(in.CSSClasses), ShowAsSource: in.ShowAsSource,
		// tree-note genres (subjectivity) carry no upstream source ids; empty (non-nil) → '{}'.
		SourceIds: []pgtype.UUID{},
	})
	if err != nil {
		return Note{}, fmt.Errorf("create note: %w", err)
	}
	return noteFromRow(&row), nil
}

// UpdateBody edits a note's title/body/tags/parent (the same edit entry point as wiki).
func (r *NoteRepo) UpdateBody(ctx context.Context, in *UpdateNoteInput) (Note, error) {
	ids, perr := parseSrcAndOwner(in.ID, in.OwnerID)
	if perr != nil {
		return Note{}, perr
	}
	parent, err := pgstore.ParseOptionalUUID(in.ParentID)
	if err != nil {
		return Note{}, fmt.Errorf("parse parent id: %w", err)
	}
	row, qerr := db.New(r.pool).UpdateNoteBody(ctx, db.UpdateNoteBodyParams{
		ID: ids.Src, OwnerID: ids.Owner, Genre: r.genre,
		Title: in.Title, Body: in.Body, Tags: nilSafeTags(in.Tags),
		ParentID: parent, ShowAsSource: in.ShowAsSource, CssClasses: nilSafeTags(in.CSSClasses),
	})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return Note{}, ErrNoteNotFound
		}
		return Note{}, fmt.Errorf("update note: %w", qerr)
	}
	return noteFromRow(&row), nil
}

// UpdateNoteInput — edits a note. ShowAsSource: opt-in/out of the visitor cited
// footer (the toggle goes through here).
type UpdateNoteInput struct {
	OwnerID      string
	ID           string
	ParentID     *string
	Title        string
	Body         string
	Tags         []string
	CSSClasses   []string
	ShowAsSource bool
}

// GetByID fetches a note in this genre; miss → ErrNoteNotFound.
func (r *NoteRepo) GetByID(ctx context.Context, ownerID, id string) (Note, error) {
	ids, perr := parseSrcAndOwner(id, ownerID)
	if perr != nil {
		return Note{}, perr
	}
	row, err := db.New(r.pool).GetNoteByID(ctx, db.GetNoteByIDParams{
		ID: ids.Src, OwnerID: ids.Owner, Genre: r.genre,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Note{}, ErrNoteNotFound
		}
		return Note{}, fmt.Errorf("get note: %w", err)
	}
	return noteFromRow(&row), nil
}

// GetMetaByID — meta (no body): used to compute path / check ACL. Miss → ErrNoteNotFound.
func (r *NoteRepo) GetMetaByID(ctx context.Context, ownerID, id string) (NoteMeta, error) {
	ids, perr := parseSrcAndOwner(id, ownerID)
	if perr != nil {
		return NoteMeta{}, perr
	}
	row, err := db.New(r.pool).GetNoteMetaByID(ctx, db.GetNoteMetaByIDParams{
		ID: ids.Src, OwnerID: ids.Owner, Genre: r.genre,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return NoteMeta{}, ErrNoteNotFound
		}
		return NoteMeta{}, fmt.Errorf("get note meta: %w", err)
	}
	return NoteMeta{
		ID: pgstore.FormatUUID(row.ID), ParentID: pgstore.OptUUIDStr(row.ParentID),
		Title: row.Title, Published: row.Published,
	}, nil
}

// ListByOwner returns the owner's notes in this genre (newest N) — satisfies
// the lister interface.
func (r *NoteRepo) ListByOwner(ctx context.Context, ownerID string, limit int32) ([]Note, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, qerr := db.New(r.pool).ListNotesByOwner(ctx, db.ListNotesByOwnerParams{
		OwnerID: ownerUUID, Genre: r.genre, Limit: limit,
	})
	if qerr != nil {
		return nil, fmt.Errorf("list notes: %w", qerr)
	}
	out := make([]Note, 0, len(rows))
	for i := range rows {
		out = append(out, noteFromRow(&rows[i]))
	}
	return out, nil
}

// ListChildren — direct children of a node (meta, no body); parentID nil = root
// level; paginated.
func (r *NoteRepo) ListChildren(
	ctx context.Context, ownerID string, parentID *string, limit, offset int32,
) ([]NoteMeta, error) {
	return listChildrenMeta(ownerID, parentID,
		func(o, p pgtype.UUID) ([]db.ListNoteChildrenRow, error) {
			return db.New(r.pool).ListNoteChildren(ctx, db.ListNoteChildrenParams{
				OwnerID: o, Genre: r.genre, Column3: p, Limit: limit, Offset: offset,
			})
		},
		func(row db.ListNoteChildrenRow) NoteMeta {
			return NoteMeta{
				ID: pgstore.FormatUUID(row.ID), ParentID: pgstore.OptUUIDStr(row.ParentID),
				Title: row.Title, Published: row.Published, HasChildren: row.HasChildren,
			}
		})
}

// Search — full DB-side keyword search (full-text), returns meta + snippet; paginated.
func (r *NoteRepo) Search(
	ctx context.Context, ownerID, query string, limit, offset int32,
) ([]NoteMeta, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, qerr := db.New(r.pool).SearchNotes(ctx, db.SearchNotesParams{
		OwnerID: ownerUUID, Genre: r.genre, PlaintoTsquery: query, Limit: limit, Offset: offset,
	})
	if qerr != nil {
		return nil, fmt.Errorf("search notes: %w", qerr)
	}
	out := make([]NoteMeta, 0, len(rows))
	for i := range rows {
		out = append(out, NoteMeta{
			ID: pgstore.FormatUUID(rows[i].ID), ParentID: pgstore.OptUUIDStr(rows[i].ParentID),
			Title: rows[i].Title, Published: rows[i].Published,
			Snippet: string(rows[i].Snippet), UpdatedAt: rows[i].UpdatedAt.Time.Unix(),
		})
	}
	return out, nil
}

// Delete hard-deletes a note (descendants cascade via FK).
func (r *NoteRepo) Delete(ctx context.Context, ownerID, id string) error {
	ids, perr := parseSrcAndOwner(id, ownerID)
	if perr != nil {
		return perr
	}
	if derr := db.New(r.pool).DeleteNote(ctx, db.DeleteNoteParams{
		ID: ids.Src, OwnerID: ids.Owner, Genre: r.genre,
	}); derr != nil {
		return fmt.Errorf("delete note: %w", derr)
	}
	return nil
}

func noteFromRow(n *db.CorpusNote) Note {
	out := Note{
		ID: pgstore.FormatUUID(n.ID), OwnerID: pgstore.FormatUUID(n.OwnerID),
		Title: n.Title, Body: n.Body, Tags: n.Tags, ShowAsSource: n.ShowAsSource,
		Published: n.Published,
	}
	if n.ParentID.Valid {
		s := pgstore.FormatUUID(n.ParentID)
		out.ParentID = &s
	}
	return out
}
