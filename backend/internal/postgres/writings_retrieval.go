// writings_retrieval.go —— WritingRepo 的 visitor 检索路径:corpus_search 的全量
// full-text 搜 + corpus_read 的按树派生 path 读。跟 wiki/output 的 Search/GetByID
// 对称(writing 自带 path 列 + published 准入,故无需 tree 上溯)。从 writings.go 拆
// 出来守 350-line cap。

package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// GetPublishedByPath —— retriever corpus_read 按树派生 path 读 published writing。
func (r *WritingRepo) GetPublishedByPath(
	ctx context.Context, ownerID, path string,
) (domain.Writing, error) {
	ownerUUID, oerr := parseUUID(ownerID)
	if oerr != nil {
		return domain.Writing{}, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	row, err := dbq.New(r.pool).GetPublishedWritingByPath(ctx, dbq.GetPublishedWritingByPathParams{
		OwnerID: ownerUUID, Path: path,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Writing{}, domain.ErrWritingNotFound
		}
		return domain.Writing{}, fmt.Errorf("get published writing by path: %w", err)
	}
	return toDomainWriting(&row), nil
}

// Search —— retriever corpus_search 全量搜 published writing(DB full-text)。
func (r *WritingRepo) Search(
	ctx context.Context, ownerID, query string, limit, offset int32,
) ([]domain.Writing, error) {
	ownerUUID, oerr := parseUUID(ownerID)
	if oerr != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	rows, err := dbq.New(r.pool).SearchPublishedWritings(ctx, dbq.SearchPublishedWritingsParams{
		OwnerID: ownerUUID, PlaintoTsquery: query, Limit: limit, Offset: offset,
	})
	if err != nil {
		return nil, fmt.Errorf("search published writings: %w", err)
	}
	return rowsToDomainWritings(rows), nil
}
