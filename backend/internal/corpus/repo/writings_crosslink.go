// writings_crosslink.go — the slim resolution-index query used by the public /writings
// path to render `[[crosslink]]`. Split out of writings.go to stay under the 350-line cap.

package repo

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// SlugTitle — the lightweight tuple returned by ListPublishedSlugAndTitle; excludes
// body_md, so a full pull of the owner's writings doesn't ship every body redundantly.
type SlugTitle struct {
	Slug  string
	Title string
}

// ListPublishedSlugAndTitle — (slug, title) for every published writing an owner has;
// the resolution index used by the public path to render [[crosslink]].
func (r *WritingRepo) ListPublishedSlugAndTitle(
	ctx context.Context, ownerID string,
) ([]SlugTitle, error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	rows, err := db.New(r.pool).ListPublishedWritingSlugAndTitle(ctx, ownerUUID)
	if err != nil {
		return nil, fmt.Errorf("list published slug+title: %w", err)
	}
	out := make([]SlugTitle, 0, len(rows))
	for i := range rows {
		out = append(out, SlugTitle{Slug: rows[i].Slug, Title: rows[i].Title})
	}
	return out, nil
}
