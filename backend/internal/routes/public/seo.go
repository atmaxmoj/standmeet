// seo.go —— real SEO: /robots.txt + /sitemap.xml. Public corpus landing/reader
// rendering (GET /wiki/* + /output/*) was split out into landing.go by #114.
//
// /robots.txt always returns; its body is controlled by SEOSettings.IndexRobots.
// /sitemap.xml lists the first owner's public page + every published wiki/output
// landing.

package public

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// SEOHandlers —— dependencies for the SEO route.
//
// No PublicURL field: every "outward URL" in robots.txt / sitemap.xml is read from
// owners.public_url (the first owner, since v1 is a single-owner instance). During the
// pre-claim phase, FirstOwner returns ok=false → robots Disallow / an empty sitemap.
type SEOHandlers struct {
	Deps owner.SEODeps
	// Sessions —— optional; the wiki-tree endpoints use it to exchange a bearer token
	// for a RoleSnapshot to do code-scope. nil (e.g. the MountRoot route only
	// mounting robots/sitemap) → falls back to anonymous scope.
	Sessions *access.VisitorSessionStore
	Log      *slog.Logger
}

// Mount wires /wiki/* + /output/*. The owner is a sole owner, so the URL carries no
// handle. Uses a chi wildcard so path can contain `/` (a group/section like
// projects/lucerna), matching the entry.path field. chi exposes the whole path
// segment as the URL param "*".
func (h *SEOHandlers) Mount(r chi.Router) {
	r.Get("/wiki/*", h.getWikiLanding())
	r.Get("/output/*", h.getOutputLanding())
	// wiki-tree —— lazy-loaded hierarchy + node context for sidebar navigation
	// (handlers live in wiki_tree.go).
	r.Get("/wiki-tree", h.getWikiTree())
	r.Get("/wiki-tree/stats", h.getWikiTreeStats())
	r.Get("/wiki-tree/context", h.getWikiTreeContext())
}

// MountRoot —— /robots.txt + /sitemap.xml are SEO's standard conventional paths,
// mounted at root.
func (h *SEOHandlers) MountRoot(r chi.Router) {
	r.Get("/robots.txt", h.robotsTxt())
	r.Get("/sitemap.xml", h.sitemapXML())
}

func (h *SEOHandlers) robotsTxt() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body := robotsBody(r.Context(), h.Deps)
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write([]byte(body)); err != nil {
			h.Log.Warn("robots.txt write", "err", err)
		}
	}
}

// robotsBody —— pre-claim / indexing disabled / public_url not set → Disallow all.
// The readiness check is centralized in owner.PublicReady.
func robotsBody(ctx context.Context, deps owner.SEODeps) string {
	soleOwner, ready := owner.PublicReady(ctx, deps)
	if !ready {
		return "User-agent: *\nDisallow: /\n"
	}
	return fmt.Sprintf("User-agent: *\nAllow: /\nSitemap: %s/sitemap.xml\n", soleOwner.PublicURL)
}

func (h *SEOHandlers) sitemapXML() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		urls := sitemapURLs(r.Context(), h.Deps)
		body := renderSitemap(urls)
		w.Header().Set("Content-Type", "application/xml; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write([]byte(body)); err != nil {
			h.Log.Warn("sitemap.xml write", "err", err)
		}
	}
}

type sitemapURL struct {
	Loc     string
	LastMod string
}

func sitemapURLs(ctx context.Context, deps owner.SEODeps) []sitemapURL {
	soleOwner, ok := owner.FirstOwner(ctx, deps)
	if !ok || soleOwner.PublicURL == "" {
		return []sitemapURL{}
	}
	out := []sitemapURL{{Loc: soleOwner.PublicURL}}
	out = appendLandings(out, soleOwner.PublicURL, "wiki", owner.IndexedWikiLandings(ctx, deps))
	out = appendLandings(out, soleOwner.PublicURL, "output", owner.IndexedOutputLandings(ctx, deps))
	return out
}

func appendLandings(
	urls []sitemapURL, base, segment string, landings []owner.LandingURL,
) []sitemapURL {
	for i := range landings {
		urls = append(urls, sitemapURL{
			Loc:     fmt.Sprintf("%s/%s/%s", base, segment, landings[i].Path),
			LastMod: time.Unix(landings[i].UpdatedAt, 0).UTC().Format(time.RFC3339),
		})
	}
	return urls
}

func renderSitemap(urls []sitemapURL) string {
	var b strings.Builder
	_, _ = b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n")
	_, _ = b.WriteString(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` + "\n")
	for i := range urls {
		renderSitemapEntry(&b, &urls[i])
	}
	_, _ = b.WriteString(`</urlset>` + "\n")
	return b.String()
}

func renderSitemapEntry(b *strings.Builder, u *sitemapURL) {
	_, _ = b.WriteString("  <url>\n    <loc>" + u.Loc + "</loc>\n")
	if u.LastMod != "" {
		_, _ = b.WriteString("    <lastmod>" + u.LastMod + "</lastmod>\n")
	}
	_, _ = b.WriteString("  </url>\n")
}
