// writings_retrieval.go — WritingRepo's visitor retrieval paths: the full-text search
// used by corpus_search, plus the by-path read used by corpus_read. After writing was
// folded into corpus_notes, path has no column and is derived from slug as
// "writings/<slug>"; GetPublishedByPath strips the prefix to recover the slug and then
// queries by slug (the retriever still passes path, so the signature is unchanged).
// Split out of writings.go to stay under the 350-line cap.

package repo

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// GetPublishedByPath — reads a published writing by path for the retriever's corpus_read.
// path is derived from slug ("writings/<slug>"), so we strip the prefix and query by slug;
// a path without that prefix is unrecognized -> ErrWritingNotFound.
func (r *WritingRepo) GetPublishedByPath(
	ctx context.Context, ownerID, path string,
) (entity.Writing, error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return entity.Writing{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	slug, ok := strings.CutPrefix(path, writingPathPrefix)
	if !ok {
		return entity.Writing{}, entity.ErrWritingNotFound
	}
	row, err := db.New(r.pool).GetPublishedWritingBySlug(ctx, db.GetPublishedWritingBySlugParams{
		OwnerID: ownerUUID, Slug: slug,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Writing{}, entity.ErrWritingNotFound
		}
		return entity.Writing{}, fmt.Errorf("get published writing by slug: %w", err)
	}
	return toDomainWriting(&row), nil
}

// Search — full-text search over published writings for the retriever's corpus_search
// (DB full-text).
func (r *WritingRepo) Search(
	ctx context.Context, ownerID, query string, limit, offset int32,
) ([]entity.Writing, error) {
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
