// seo.go —— 真 SEO：/robots.txt + /sitemap.xml。公开 corpus landing/reader 渲染
// (GET /wiki/* + /output/*)#114 已拆到 landing.go。
//
// /robots.txt 总是返；body 受 SEOSettings.IndexRobots 控制。
// /sitemap.xml 列首位 owner 的 public page + 所有 published wiki/output landing。

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

// SEOHandlers —— SEO 路由依赖。
//
// 没有 PublicURL 字段：robots.txt / sitemap.xml 里所有"对外 URL" 都从
// owners.public_url 读（首位 owner，v1 单 owner instance）。pre-claim 阶段
// FirstOwner 返 ok=false → robots Disallow / sitemap 空。
type SEOHandlers struct {
	Deps owner.SEODeps
	// Sessions —— 可选;wiki-tree 端点用它把 bearer token 换 RoleSnapshot 做
	// code-scope。nil(如 MountRoot 那条只挂 robots/sitemap)→ 退到匿名 scope。
	Sessions *access.VisitorSessionStore
	Log      *slog.Logger
}

// Mount 挂 /wiki/* + /output/*。owner 是 sole owner，URL 不带 handle。
// 用 chi wildcard 让 path 可含 `/` (projects/lucerna 这种分组分段)，
// 跟 entry.path 字段对齐。chi 把整段 path 暴露成 URL param "*"。
func (h *SEOHandlers) Mount(r chi.Router) {
	r.Get("/wiki/*", h.getWikiLanding())
	r.Get("/output/*", h.getOutputLanding())
	// wiki-tree —— sidebar 导航的懒加载分层 + 节点上下文(handler 在 wiki_tree.go)。
	r.Get("/wiki-tree", h.getWikiTree())
	r.Get("/wiki-tree/stats", h.getWikiTreeStats())
	r.Get("/wiki-tree/context", h.getWikiTreeContext())
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
// readiness check 集中在 owner.PublicReady 里。
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
