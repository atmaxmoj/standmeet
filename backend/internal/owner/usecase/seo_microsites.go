// seo_microsites.go — the microsite slice of SEO: which of the owner's pages belong in the
// sitemap. Split out of seo.go to keep that file under the max-lines cap.

package usecase

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// IndexedMicrosites — for sitemap.xml, the sole owner's live microsites served at /p/<slug>. The
// reserved home page is excluded: it is served at the site root `/`, which the sitemap already
// lists as the owner's public URL. A draft or taken-down page (no live build) never appears.
func IndexedMicrosites(ctx context.Context, deps SEODeps) []LandingURL {
	soleOwner, ok := FirstOwner(ctx, deps)
	if !ok {
		return []LandingURL{}
	}
	pages, err := deps.Microsites.ListByOwner(ctx, soleOwner.ID)
	if err != nil {
		return []LandingURL{}
	}
	out := make([]LandingURL, 0, len(pages))
	for i := range pages {
		if liveNonHomeMicrosite(&pages[i]) {
			out = append(out, LandingURL{Path: pages[i].Slug, UpdatedAt: pages[i].UpdatedAt.Unix()})
		}
	}
	return out
}

// liveNonHomeMicrosite — a page that belongs in the sitemap: it has a live build, and it is not the
// reserved home page (served at `/`, already listed as the owner's public URL).
func liveNonHomeMicrosite(p *entity.Microsite) bool {
	return p.LiveBuildID != nil && p.Slug != HomepageSlug
}
