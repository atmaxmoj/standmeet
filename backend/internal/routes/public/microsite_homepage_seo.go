// microsite_homepage_seo.go —— the site root's SEO on the public side. The homepage's SEO is
// owner-level (decoupled from the `home` microsite), so it is served two ways: overlaid onto a live
// `home` build's <head> (serveSlugAt, via homepageSEOOverlay + applySEOOverlay), and handed to the
// app's DefaultHome as JSON (serveHomepageSEO) for when no build serves `/`. Split out of
// microsites.go to keep that file under the max-lines cap.

package public

import (
	"context"
	"encoding/json"
	"net/http"
)

// pageSEO —— a site-root SEO triple (empty field = not emitted). Neutral strings so the public
// routes package needn't import the owner repo (arch boundary).
type pageSEO struct {
	title       string
	description string
	image       string
}

// homepageSEOResponse —— the site-root SEO as JSON. Empty field = nothing set (the reader emits no
// tag for it).
type homepageSEOResponse struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Image       string `json:"image"`
}

func (h *MicrositeHandlers) serveHomepageSEO() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Same read path as the overlay (nil = unwired / unreadable = nothing set), so the two
		// callers can never disagree about what the site-root SEO is.
		resp := seoResponseFrom(h.homepageSEOOverlay(r.Context()))
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		if encErr := json.NewEncoder(w).Encode(resp); encErr != nil {
			h.Log.Warn("encode homepage seo", logErr, encErr)
		}
	}
}

// seoResponseFrom —— the JSON body for a site-root SEO triple (nil overlay = nothing set).
func seoResponseFrom(o *pageSEO) homepageSEOResponse {
	if o == nil {
		return homepageSEOResponse{}
	}
	return homepageSEOResponse{Title: o.title, Description: o.description, Image: o.image}
}

// homepageSEOOverlay —— the owner's site-root SEO for this request, or nil if unwired / unreadable
// (serving must not fail because the SEO couldn't be read — it just injects nothing).
func (h *MicrositeHandlers) homepageSEOOverlay(ctx context.Context) *pageSEO {
	if h.HomepageSEO == nil {
		return nil
	}
	title, description, image, err := h.HomepageSEO(ctx)
	if err != nil {
		h.Log.Warn("read homepage seo for site root", "err", err)
		return nil
	}
	return &pageSEO{title: title, description: description, image: image}
}

// applySEOOverlay —— override an asset's SEO with the owner's site-root values (nil = keep the
// build's). An empty field clears that tag (nil pointer): setting only a title emits only a title.
func applySEOOverlay(asset *BuiltAsset, overlay *pageSEO) {
	if overlay == nil {
		return
	}
	asset.SeoTitle = optStr(overlay.title)
	asset.SeoDescription = optStr(overlay.description)
	asset.SeoImage = optStr(overlay.image)
}

// optStr —— "" → nil (no tag), else a pointer to the value.
func optStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
