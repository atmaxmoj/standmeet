// writings_retrieval.go —— WritingRepo 的 visitor 检索路径:corpus_search 的全量
// full-text 搜 + corpus_read 的按 path 读。writing 折进 corpus_notes 后 path 不存列,
// 由 slug 派生 "writings/<slug>";GetPublishedByPath 剥前缀取 slug 再按 slug 查(retriever
// 传的仍是 path,签名不变)。从 writings.go 拆出来守 350-line cap。

package corpus

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// GetPublishedByPath —— retriever corpus_read 按 path 读 published writing。path 派生自 slug
// ("writings/<slug>"),故剥前缀取 slug 再查;不带前缀的 path 认不到 → ErrWritingNotFound。
func (r *WritingRepo) GetPublishedByPath(
	ctx context.Context, ownerID, path string,
) (Writing, error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return Writing{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	slug, ok := strings.CutPrefix(path, writingPathPrefix)
	if !ok {
		return Writing{}, ErrWritingNotFound
	}
	row, err := db.New(r.pool).GetPublishedWritingBySlug(ctx, db.GetPublishedWritingBySlugParams{
		OwnerID: ownerUUID, Slug: slug,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Writing{}, ErrWritingNotFound
		}
		return Writing{}, fmt.Errorf("get published writing by slug: %w", err)
	}
	return toDomainWriting(&row), nil
}

// Search —— retriever corpus_search 全量搜 published writing(DB full-text)。
func (r *WritingRepo) Search(
	ctx context.Context, ownerID, query string, limit, offset int32,
) ([]Writing, error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	rows, err := db.New(r.pool).SearchPublishedWritings(ctx, db.SearchPublishedWritingsParams{
		OwnerID: ownerUUID, PlaintoTsquery: query, Limit: limit, Offset: offset,
	})
	if err != nil {
		return nil, fmt.Errorf("search published writings: %w", err)
	}
	return rowsToDomainWritings(rows), nil
}
