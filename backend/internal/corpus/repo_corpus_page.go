// corpus_page.go —— admin 语料 grid 的 keyset 分页（infinite scroll）。一次取一页
// (created_at DESC, id DESC 复合游标),配 path_titles 让服务端 slug 出地址(半页也对)。
// 跟懒树共用 TreeChild 载体(grid 不需要 has_children,留 false)。owner-scoped、全状态。

package corpus

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/pgstore"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
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
	limit   int32
}

func adminPageFetch[T any](
	ctx context.Context, req pageReq, toDomain func(*dbq.CorpusNote) T,
) ([]TreeChild[T], error) {
	ownerUUID, err := pgstore.ParseUUID(req.ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	cp, cerr := pageCursorParams(req.cursor)
	if cerr != nil {
		return nil, cerr
	}
	rows, qerr := dbq.New(req.pool).ListNotesByOwnerPage(ctx, dbq.ListNotesByOwnerPageParams{
		OwnerID: ownerUUID, Genre: req.genre, Column3: cp.ts, Column4: cp.id, Limit: req.limit,
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

// ListPage —— one grid page of the wiki genre (owner-scoped, all statuses).
func (r *WikiRepo) ListPage(
	ctx context.Context, ownerID string, cursor *PageCursor, limit int32,
) ([]TreeChild[Wiki], error) {
	return adminPageFetch(ctx, pageReq{r.pool, cursor, ownerID, genreWiki, limit}, toDomainWiki)
}

// ListPage —— one grid page of the output genre.
func (r *OutputRepo) ListPage(
	ctx context.Context, ownerID string, cursor *PageCursor, limit int32,
) ([]TreeChild[Output], error) {
	return adminPageFetch(ctx, pageReq{r.pool, cursor, ownerID, genreOutput, limit}, toDomainOutput)
}

// ListPage —— one grid page of the raw inbox genre.
func (r *RawRepo) ListPage(
	ctx context.Context, ownerID string, cursor *PageCursor, limit int32,
) ([]TreeChild[Raw], error) {
	return adminPageFetch(ctx, pageReq{r.pool, cursor, ownerID, genreRaw, limit}, toDomainRaw)
}

// ListPage —— one grid page of writings (genre='writing').
func (r *WritingRepo) ListPage(
	ctx context.Context, ownerID string, cursor *PageCursor, limit int32,
) ([]TreeChild[Writing], error) {
	req := pageReq{r.pool, cursor, ownerID, genreWriting, limit}
	return adminPageFetch(ctx, req, toDomainWriting)
}
