// seo.go —— SEO 三件套：/robots.txt + /sitemap.xml + GET wiki landing。
//
// /robots.txt 总是返；body 受 SEOSettings.IndexRobots 控制。
// /sitemap.xml 列首位 owner 的 public page + 所有 seo_indexed wiki landing。
// GET /api/v1/wiki/:handle/:slug —— wiki landing 反查（owner 不存在 / slug 不
// 存在 / 非 public 都 404）。

package public

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/wangsijie/standmeet/internal/apierr"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/usecases"
)

// SEOHandlers —— SEO 路由依赖。
type SEOHandlers struct {
	Deps      usecases.SEODeps
	Log       *slog.Logger
	PublicURL string
}

// Mount 挂 /wiki/{handle}/{slug}（在 /api/v1/ 下）。
func (h *SEOHandlers) Mount(r chi.Router) {
	r.Get("/wiki/{handle}/{slug}", h.getWikiLanding())
}

// MountRoot —— /robots.txt + /sitemap.xml 是 SEO 标准约定路径，挂 root。
func (h *SEOHandlers) MountRoot(r chi.Router) {
	r.Get("/robots.txt", h.robotsTxt())
	r.Get("/sitemap.xml", h.sitemapXML())
}

func (h *SEOHandlers) robotsTxt() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body := robotsBody(r.Context(), h.Deps, h.PublicURL)
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write([]byte(body)); err != nil {
			h.Log.Warn("robots.txt write", "err", err)
		}
	}
}

func robotsBody(ctx context.Context, deps usecases.SEODeps, publicURL string) string {
	settings, ok := usecases.FirstOwnerSettings(ctx, deps)
	if !ok || !settings.IndexRobots {
		return "User-agent: *\nDisallow: /\n"
	}
	base := strings.TrimRight(publicURL, "/")
	return fmt.Sprintf("User-agent: *\nAllow: /\nSitemap: %s/sitemap.xml\n", base)
}

func (h *SEOHandlers) sitemapXML() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		urls := sitemapURLs(r.Context(), h.Deps, h.PublicURL)
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

func sitemapURLs(
	ctx context.Context, deps usecases.SEODeps, publicURL string,
) []sitemapURL {
	base := strings.TrimRight(publicURL, "/")
	owner, ok := usecases.FirstOwner(ctx, deps)
	if !ok {
		return []sitemapURL{}
	}
	out := []sitemapURL{{Loc: fmt.Sprintf("%s/%s", base, owner.Handle)}}
	return appendWikiLandings(ctx, deps, owner.Handle, base, out)
}

func appendWikiLandings(
	ctx context.Context, deps usecases.SEODeps,
	handle, base string, urls []sitemapURL,
) []sitemapURL {
	landings := usecases.IndexedWikiLandings(ctx, deps, handle)
	for i := range landings {
		urls = append(urls, sitemapURL{
			Loc:     fmt.Sprintf("%s/%s/wiki/%s", base, handle, landings[i].Slug),
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

func (h *SEOHandlers) getWikiLanding() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		handle := chi.URLParam(r, "handle")
		slug := chi.URLParam(r, "slug")
		view, err := loadWikiLandingView(r.Context(), h.Deps, handle, slug)
		if err != nil {
			handleLandingErr(h.Log, w, err)
			return
		}
		writeJSONWikiLanding(h.Log, w, &view)
	}
}

type wikiLandingView struct {
	OwnerHandle    string `json:"owner_handle"`
	Slug           string `json:"slug"`
	Title          string `json:"title"`
	Body           string `json:"body"`
	SEODescription string `json:"seo_description"`
	UpdatedAt      string `json:"updated_at"`
}

func loadWikiLandingView(
	ctx context.Context, deps usecases.SEODeps, handle, slug string,
) (wikiLandingView, error) {
	wiki, err := usecases.GetWikiLanding(ctx, deps, &usecases.WikiLandingInput{
		Handle: handle, Slug: slug,
	})
	if err != nil {
		return wikiLandingView{}, err
	}
	return wikiLandingView{
		OwnerHandle:    handle,
		Slug:           slug,
		Title:          wiki.Title,
		Body:           wiki.Body,
		SEODescription: wiki.SEODescription,
		UpdatedAt:      wiki.UpdatedAt.UTC().Format(time.RFC3339),
	}, nil
}

func writeJSONWikiLanding(log *slog.Logger, w http.ResponseWriter, view *wikiLandingView) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(view); err != nil {
		log.Error("encode wiki landing", "err", err)
	}
}

func handleLandingErr(log *slog.Logger, w http.ResponseWriter, err error) {
	env := classifyLandingErr(err)
	if env.Status >= http.StatusInternalServerError {
		log.Error("wiki landing", "err", err)
	}
	writeError(log, w, env)
}

func classifyLandingErr(err error) apierr.Envelope {
	if errors.Is(err, domain.ErrWikiNotFound) || errors.Is(err, domain.ErrOwnerNotFound) {
		return apierr.Envelope{
			Status: http.StatusNotFound, Code: "not_found", Message: "page not found",
		}
	}
	return apierr.Envelope{
		Status: http.StatusInternalServerError, Code: "server_error", Message: "internal error",
	}
}
