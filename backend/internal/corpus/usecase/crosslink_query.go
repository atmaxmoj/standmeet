// crosslink_query.go —— query wrapper used when public /writings renders [[crosslink]].
// Lets publicroutes avoid importing postgres directly — it gets the
// resolution index and backlink list through usecases instead.

package usecase

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

// CrossLinkQueryDeps —— query deps used when public /writings GET renders [[crosslink]].
// Kept separate from WritingsTxDeps because the public path doesn't need Assets / tx.
type CrossLinkQueryDeps struct {
	Writings    *repo.WritingRepo
	WritingRefs *repo.WritingRefRepo
}

// BacklinkRef —— one backlink (the source writing's slug + title).
type BacklinkRef struct {
	Slug  string
	Title string
}

// LoadCrossLinkIndex —— fetches (slug, title) for all of the owner's published writings,
// for `[[X]]` rewrite to use. Empty owner / no writings → empty slice.
func LoadCrossLinkIndex(
	ctx context.Context, deps CrossLinkQueryDeps, ownerID string,
) ([]repo.SlugTitle, error) {
	if ownerID == "" {
		return nil, apierr.ErrEmptyField
	}
	rows, err := deps.Writings.ListPublishedSlugAndTitle(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("crosslink slug index: %w", err)
	}
	out := make([]repo.SlugTitle, 0, len(rows))
	for i := range rows {
		out = append(out, repo.SlugTitle{Slug: rows[i].Slug, Title: rows[i].Title})
	}
	return out, nil
}

// ListBacklinks —— lists every published source writing (slug+title) that links to writingID.
func ListBacklinks(
	ctx context.Context, deps CrossLinkQueryDeps, ownerID, writingID string,
) ([]BacklinkRef, error) {
	if ownerID == "" || writingID == "" {
		return nil, apierr.ErrEmptyField
	}
	rows, err := deps.WritingRefs.BacklinksFor(ctx, ownerID, writingID)
	if err != nil {
		return nil, fmt.Errorf("list backlinks: %w", err)
	}
	out := make([]BacklinkRef, 0, len(rows))
	for i := range rows {
		out = append(out, BacklinkRef{Slug: rows[i].Slug, Title: rows[i].Title})
	}
	return out, nil
}
