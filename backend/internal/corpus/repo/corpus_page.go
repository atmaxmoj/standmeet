// corpus_page.go —— keyset pagination (infinite scroll) for the admin corpus grid. Fetches
// one page at a time (created_at DESC, id DESC composite cursor), paired with path_titles so
// the server can slug out an address (correct even for a half-loaded page). Shares the
// TreeChild carrier with the lazy tree (grid doesn't need has_children, leaves it false).
// Owner-scoped, all statuses.

package repo

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// PageCursor —— keyset position (the previous page's last row). nil = first page.
type PageCursor struct {
	CreatedAt time.Time
	ID        string
}

type pageReq struct {
	pool    *pgstore.Pool
	cursor  *PageCursor
	ownerID string
	genre   string
	// tag —— "" = no filter. Filtering must happen **when the page is fetched**: if the client
	// gets a page and filters afterward, it's only filtering that page, yet the panel treats
	// the result as the answer for the whole corpus (F-L-23: 137 math notes showed as 1).
	tag   string
	limit int32
}

func adminPageFetch[T any](
	ctx context.Context, req pageReq, toDomain func(*db.CorpusNote) T,
) ([]TreeChild[T], error) {
	ownerUUID, err := pgstore.ParseUUID(req.ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	cp, cerr := pageCursorParams(req.cursor)
	if cerr != nil {
		return nil, cerr
	}
	rows, qerr := db.New(req.pool).ListNotesByOwnerPage(ctx, db.ListNotesByOwnerPageParams{
		OwnerID: ownerUUID, Genre: req.genre, Column3: cp.ts, Column4: cp.id,
		Limit: req.limit, Column6: req.tag,
	})
	if qerr != nil {
		return nil, fmt.Errorf("list page: %w", qerr)
	}
	out := make([]TreeChild[T], 0, len(rows))
	for i := range rows {
		out = append(out, TreeChild[T]{
			Entry: toDomain(&rows[i].CorpusNote), PathTitles: rows[i].PathTitles,
		})
	}
	return out, nil
}

// cursorPg —— the keyset cursor as pg params (both invalid = first page).
type cursorPg struct {
	ts pgtype.Timestamptz
	id pgtype.UUID
}

// pageCursorParams —— nil cursor → NULL params (first page); else the keyset values.
func pageCursorParams(c *PageCursor) (cursorPg, error) {
	if c == nil {
		return cursorPg{ts: pgtype.Timestamptz{Valid: false}, id: pgtype.UUID{Valid: false}}, nil
	}
	id, err := pgstore.ParseUUID(c.ID)
	if err != nil {
		return cursorPg{}, fmt.Errorf("parse cursor id: %w", err)
	}
	return cursorPg{ts: pgtype.Timestamptz{Time: c.CreatedAt, Valid: true}, id: id}, nil
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

// ListPage —— one grid page of the wiki genre (owner-scoped, all statuses). tag "" = no filter.
func (r *WikiRepo) ListPage(
	ctx context.Context, ownerID string, cursor *PageCursor, limit int32, tag string,
) ([]TreeChild[entity.Wiki], error) {
	req := pageReq{r.pool, cursor, ownerID, genreWiki, tag, limit}
	return adminPageFetch(ctx, req, toDomainWiki)
}

// ListPage —— one grid page of the output genre. tag "" = no filter.
func (r *OutputRepo) ListPage(
	ctx context.Context, ownerID string, cursor *PageCursor, limit int32, tag string,
) ([]TreeChild[entity.Output], error) {
	req := pageReq{r.pool, cursor, ownerID, genreOutput, tag, limit}
	return adminPageFetch(ctx, req, toDomainOutput)
}

// ListPage —— one grid page of the raw inbox genre. tag "" = no filter.
func (r *RawRepo) ListPage(
	ctx context.Context, ownerID string, cursor *PageCursor, limit int32, tag string,
) ([]TreeChild[entity.Raw], error) {
	return adminPageFetch(ctx, pageReq{r.pool, cursor, ownerID, genreRaw, tag, limit}, toDomainRaw)
}

// ListPage —— one grid page of writings (genre='writing'). tag "" = no filter.
func (r *WritingRepo) ListPage(
	ctx context.Context, ownerID string, cursor *PageCursor, limit int32, tag string,
) ([]TreeChild[entity.Writing], error) {
	req := pageReq{r.pool, cursor, ownerID, genreWriting, tag, limit}
	return adminPageFetch(ctx, req, toDomainWriting)
}
