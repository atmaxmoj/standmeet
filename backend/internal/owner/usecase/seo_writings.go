// seo_writings.go —— the published writings a crawler should find, listed in sitemap.xml at
// /writings/<slug>. They were missing from the sitemap entirely (found 2026-09-30).

package usecase

import "context"

// IndexedWritings —— every published writing of the sole owner, by slug. No update time on this
// slim query, so the sitemap entry carries no lastmod (UpdatedAt 0).
func IndexedWritings(ctx context.Context, deps SEODeps) []LandingURL {
	soleOwner, ok := FirstOwner(ctx, deps)
	if !ok || deps.Writings == nil {
		return []LandingURL{}
	}
	rows, err := deps.Writings.ListPublishedSlugAndTitle(ctx, soleOwner.ID)
	if err != nil {
		return []LandingURL{}
	}
	out := make([]LandingURL, 0, len(rows))
	for i := range rows {
		out = append(out, LandingURL{Path: rows[i].Slug})
	}
	return out
}
