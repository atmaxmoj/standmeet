// microsite_homepage_seo.go —— the site-root SEO write. The homepage's SEO is decoupled from the
// `home` microsite (it lives on the owner), so set_seo for the reserved home slug writes the owner
// store; every other /p/<slug> page keeps its SEO on its own row. Split out of microsite.go to keep
// that file under the max-lines cap.

package usecase

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// HomepageSEOStore —— writes the owner's site-root SEO. The homepage's SEO is decoupled from the
// `home` microsite (it lives on the owner), so set_seo for the reserved home slug goes here instead
// of a microsite row. The owner repo satisfies it; wired on the dispatcher's deps only.
type HomepageSEOStore interface {
	SetHomepageSEO(ctx context.Context, ownerID string, f repo.SEOFields) error
}

// SetPageSEOInput — set_seo's input. Empty title/description/image clear that field.
type SetPageSEOInput struct {
	OwnerID     string
	Slug        string
	Title       string
	Description string
	Image       string
}

// SetPageSEO — set a page's per-page SEO (title, description, Open Graph / share-card image)
// injected into its served <head>. The homepage is special (see below); every other page keeps its
// SEO on its own microsite row.
func SetPageSEO(ctx context.Context, deps MicrositeDeps, in *SetPageSEOInput) error {
	fields := repo.SEOFields{Title: in.Title, Description: in.Description, Image: in.Image}
	// The homepage's SEO is the SITE ROOT's, kept on the OWNER and decoupled from the `home`
	// microsite — so it holds whether or not a home page is materialized / built / deleted. Set it
	// on the owner store, never materializing a microsite row.
	if in.Slug == HomepageSlug {
		if deps.HomepageSEO == nil {
			return errors.New("homepage seo store not wired")
		}
		if err := deps.HomepageSEO.SetHomepageSEO(ctx, in.OwnerID, fields); err != nil {
			return fmt.Errorf("set homepage seo: %w", err)
		}
		return nil
	}
	// A /p/<slug> page keeps its SEO on its own row (which exists once the page was created).
	if err := deps.Pages.SetSEO(ctx, in.OwnerID, in.Slug, &fields); err != nil {
		return fmt.Errorf("set page seo: %w", err)
	}
	return nil
}
