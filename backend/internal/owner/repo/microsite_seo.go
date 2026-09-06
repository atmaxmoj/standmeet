// microsite_seo.go — per-page SEO (seo_title / seo_description), injected into the served page's
// <head>. Kept out of microsites.go to hold that file under max-lines.

package repo

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
)

// SEOFields — a page's per-page SEO values (title, description, Open Graph / share-card image).
// Empty strings clear a field (stored as NULL).
type SEOFields struct {
	Title       string
	Description string
	Image       string
}

// SetSEO sets a page's SEO fields, scoped to (owner, slug). An empty string clears a field (stored
// as NULL), so the built page keeps its own <title> and no image meta is emitted.
func (r *MicrositeRepo) SetSEO(ctx context.Context, ownerID, slug string, f *SEOFields) error {
	oid, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return fmt.Errorf("parse owner id: %w", perr)
	}
	if err := db.New(r.pool).SetMicrositeSEO(ctx, db.SetMicrositeSEOParams{
		OwnerID: oid, Slug: slug,
		SeoTitle: nilIfEmpty(f.Title), SeoDescription: nilIfEmpty(f.Description),
		SeoImage: nilIfEmpty(f.Image),
	}); err != nil {
		return fmt.Errorf("set microsite seo: %w", err)
	}
	return nil
}
