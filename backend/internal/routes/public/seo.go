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

	"github.com/atmaxmoj/standmeet/internal/apierr"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/session"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// SEOHandlers —— SEO 路由依赖。
//
// 没有 PublicURL 字段：robots.txt / sitemap.xml 里所有"对外 URL" 都从
// owners.public_url 读（首位 owner，v1 单 owner instance）。pre-claim 阶段
// FirstOwner 返 ok=false → robots Disallow / sitemap 空。
type SEOHandlers struct {
	Deps usecases.SEODeps
	// Sessions —— 可选;wiki-tree 端点用它把 bearer token 换 RoleSnapshot 做
	// code-scope。nil(如 MountRoot 那条只挂 robots/sitemap)→ 退到匿名 scope。
	Sessions *session.VisitorSessionStore
	Log      *slog.Logger
}

// Mount 挂 /wiki/* + /output/*。owner 是 sole owner，URL 不带 handle。
// 用 chi wildcard 让 path 可含 `/` (projects/lucerna 这种分组分段)，
// 跟 entry.path 字段对齐。chi 把整段 path 暴露成 URL param "*"。
func (h *SEOHandlers) Mount(r chi.Router) {
	r.Get("/wiki/*", h.getWikiLanding())
	r.Get("/output/*", h.getOutputLanding())
	// wiki-tree —— sidebar 导航的懒加载分层(handler 在 wiki_tree.go)。
	r.Get("/wiki-tree", h.getWikiTree())
}

// MountRoot —— /robots.txt + /sitemap.xml 是 SEO 标准约定路径，挂 root。
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

// robotsBody —— pre-claim / index-disabled / public_url 未填 → Disallow all。
// readiness check 集中在 usecases.PublicReady 里。
func robotsBody(ctx context.Context, deps usecases.SEODeps) string {
	owner, ready := usecases.PublicReady(ctx, deps)
	if !ready {
		return "User-agent: *\nDisallow: /\n"
	}
	return fmt.Sprintf("User-agent: *\nAllow: /\nSitemap: %s/sitemap.xml\n", owner.PublicURL)
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

func sitemapURLs(ctx context.Context, deps usecases.SEODeps) []sitemapURL {
	owner, ok := usecases.FirstOwner(ctx, deps)
	if !ok || owner.PublicURL == "" {
		return []sitemapURL{}
	}
	out := []sitemapURL{{Loc: owner.PublicURL}}
	out = appendLandings(out, owner.PublicURL, "wiki", usecases.IndexedWikiLandings(ctx, deps))
	out = appendLandings(out, owner.PublicURL, "output", usecases.IndexedOutputLandings(ctx, deps))
	return out
}

func appendLandings(
	urls []sitemapURL, base, segment string, landings []usecases.LandingURL,
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

func (h *SEOHandlers) getWikiLanding() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		slug := chi.URLParam(r, "*")
		view, err := loadWikiLandingView(r.Context(), h.Deps, slug)
		if err != nil {
			handleLandingErr(h.Log, w, err)
			return
		}
		writeJSONWikiLanding(h.Log, w, &view)
	}
}

type wikiLandingView struct {
	Path           string `json:"path"`
	Title          string `json:"title"`
	Body           string `json:"body"`
	SEODescription string `json:"seo_description"`
	UpdatedAt      string `json:"updated_at"`
}

func loadWikiLandingView(
	ctx context.Context, deps usecases.SEODeps, slug string,
) (wikiLandingView, error) {
	wiki, err := usecases.GetWikiLanding(ctx, deps, slug)
	if err != nil {
		return wikiLandingView{}, err
	}
	return wikiLandingView{
		Path:           slug,
		Title:          wiki.Title(),
		Body:           wiki.Body(),
		SEODescription: wiki.SEODescription(),
		UpdatedAt:      wiki.UpdatedAt().UTC().Format(time.RFC3339),
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

// landingNotFound —— wiki / output 公共 not-found envelope。
var landingNotFound = apierr.Envelope{
	Status: http.StatusNotFound, Code: "not_found", Message: "page not found",
}

// landingNotFoundSentinels —— landing 路径上视作 404 的 sentinel error 集合。
var landingNotFoundSentinels = []error{
	domain.ErrWikiNotFound,
	domain.ErrOutputNotFound,
	domain.ErrOwnerNotFound,
}

func isLandingNotFound(err error) bool {
	for _, sentinel := range landingNotFoundSentinels {
		if errors.Is(err, sentinel) {
			return true
		}
	}
	return false
}

func classifyLandingErr(err error) apierr.Envelope {
	if isLandingNotFound(err) {
		return landingNotFound
	}
	return apierr.Envelope{
		Status: http.StatusInternalServerError, Code: "server_error", Message: "internal error",
	}
}

func (h *SEOHandlers) getOutputLanding() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		slug := chi.URLParam(r, "*")
		view, err := loadOutputLandingView(r.Context(), h.Deps, slug)
		if err != nil {
			handleLandingErr(h.Log, w, err)
			return
		}
		writeJSONOutputLanding(h.Log, w, &view)
	}
}

// outputLandingView —— 跟 wikiLandingView 字段对齐，前端 SDK 可复用渲染。
type outputLandingView struct {
	Path           string `json:"path"`
	Title          string `json:"title"`
	Body           string `json:"body"`
	SEODescription string `json:"seo_description"`
	UpdatedAt      string `json:"updated_at"`
}

func loadOutputLandingView(
	ctx context.Context, deps usecases.SEODeps, slug string,
) (outputLandingView, error) {
	out, err := usecases.GetOutputLanding(ctx, deps, slug)
	if err != nil {
		return outputLandingView{}, err
	}
	return outputLandingView{
		Path:           slug,
		Title:          out.Title(),
		Body:           out.Body(),
		SEODescription: out.SEODescription(),
		UpdatedAt:      out.UpdatedAt().UTC().Format(time.RFC3339),
	}, nil
}

func writeJSONOutputLanding(log *slog.Logger, w http.ResponseWriter, view *outputLandingView) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(view); err != nil {
		log.Error("encode output landing", "err", err)
	}
}
