// corpus_page.go —— one page of one genre, newest first, on the shared paginator
// (docs/design/paging.md). corpus.list, the admin grids, the parent pickers and writings.list all
// read it. Each row carries its root→leaf title chain (the address, right on a partial page) and
// its descendant count (the delete warning, F-L-24). Owner-scoped, all statuses.

package repo

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/paging"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// NoteFilter —— the filters every genre's list page takes. Tag: carries this tag. Q: title
// substring. State: published / draft, and for raw unprocessed / promoted / flagged. Empty = any.
type NoteFilter struct {
	Tag   string `json:"tag"`
	Q     string `json:"q"`
	State string `json:"state"`
}

type pageReq struct {
	pool    *pgstore.Pool
	ownerID string
	genre   string
	filter  NoteFilter
	req     paging.Request
}

func notesPage[T any](
	ctx context.Context, pr *pageReq, toDomain func(*db.CorpusNote) T,
) (paging.Page[TreeChild[T]], error) {
	owner, err := pgstore.ParseUUID(pr.ownerID)
	if err != nil {
		return paging.Page[TreeChild[T]]{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	after, err := pgstore.CursorArgs(pr.req.After)
	if err != nil {
		return paging.Page[TreeChild[T]]{}, fmt.Errorf("list %s page: %w", pr.genre, err)
	}
	q := db.New(pr.pool)
	f := pr.filter
	rows, err := q.ListNotesPage(ctx, db.ListNotesPageParams{
		OwnerID: owner, Genre: pr.genre, Tag: f.Tag, Q: f.Q, State: f.State,
		AfterAt: after.At, AfterID: after.ID, Lim: pr.req.Fetch(),
	})
	if err != nil {
		return paging.Page[TreeChild[T]]{}, fmt.Errorf("list %s page: %w", pr.genre, err)
	}
	total, err := q.CountNotes(ctx, db.CountNotesParams{
		OwnerID: owner, Genre: pr.genre, Tag: f.Tag, Q: f.Q, State: f.State,
	})
	if err != nil {
		return paging.Page[TreeChild[T]]{}, fmt.Errorf("count %s: %w", pr.genre, err)
	}
	page := paging.Cut(rows, pr.req, func(r *db.ListNotesPageRow) paging.Cursor {
		n := &r.CorpusNote
		return paging.Cursor{At: n.CreatedAt.Time, ID: pgstore.FormatUUID(n.ID)}
	})
	return paging.Each(page, func(r *db.ListNotesPageRow) TreeChild[T] {
		return TreeChild[T]{
			Entry: toDomain(&r.CorpusNote), PathTitles: r.PathTitles, Descendants: r.Descendants,
		}
	}).WithTotal(total), nil
}

// listGenreTags —— every tag used anywhere in one genre. Corpus-wide, not page-scoped: if the
// tag row is derived from the already-loaded page, a tag that exists only outside that page
// never even gets a chip (the second half of F-L-23).
func listGenreTags(
	ctx context.Context, pool *pgstore.Pool, ownerID, genre string,
) ([]string, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	tags, qerr := db.New(pool).ListDistinctTagsByGenre(ctx, db.ListDistinctTagsByGenreParams{
		OwnerID: ownerUUID, Genre: genre,
	})
	if qerr != nil {
		return nil, fmt.Errorf("list genre tags: %w", qerr)
	}
	return tags, nil
}

// ListTags —— every tag used across the wiki genre (owner-scoped).
func (r *WikiRepo) ListTags(ctx context.Context, ownerID string) ([]string, error) {
	return listGenreTags(ctx, r.pool, ownerID, genreWiki)
}

// ListPage —— one page of the wiki genre.
func (r *WikiRepo) ListPage(
	ctx context.Context, ownerID string, f NoteFilter, req paging.Request,
) (paging.Page[TreeChild[entity.Wiki]], error) {
	return notesPage(ctx, &pageReq{r.pool, ownerID, genreWiki, f, req}, toDomainWiki)
}

// ListPage —— one page of the output genre.
func (r *OutputRepo) ListPage(
	ctx context.Context, ownerID string, f NoteFilter, req paging.Request,
) (paging.Page[TreeChild[entity.Output]], error) {
	return notesPage(ctx, &pageReq{r.pool, ownerID, genreOutput, f, req}, toDomainOutput)
}

// ListPage —— one page of the raw inbox.
func (r *RawRepo) ListPage(
	ctx context.Context, ownerID string, f NoteFilter, req paging.Request,
) (paging.Page[TreeChild[entity.Raw]], error) {
	return notesPage(ctx, &pageReq{r.pool, ownerID, genreRaw, f, req}, toDomainRaw)
}

// ListPage —— one page of a NoteRepo's genre (subjectivity).
func (r *NoteRepo) ListPage(
	ctx context.Context, ownerID string, f NoteFilter, req paging.Request,
) (paging.Page[TreeChild[Note]], error) {
	return notesPage(ctx, &pageReq{r.pool, ownerID, r.genre, f, req}, noteFromRow)
}

// ListPage —— one page of writings (genre='writing').
func (r *WritingRepo) ListPage(
	ctx context.Context, ownerID string, f NoteFilter, req paging.Request,
) (paging.Page[TreeChild[entity.Writing]], error) {
	return notesPage(ctx, &pageReq{r.pool, ownerID, genreWriting, f, req}, toDomainWriting)
}
