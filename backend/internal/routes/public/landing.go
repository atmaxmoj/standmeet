// landing.go —— #114 公开 corpus landing/reader 渲染(从原 seo.go 拆出)。
// GET /wiki/* + /output/* —— sole-owner instance,URL 不带 handle,chi wildcard
// 让 path 含 `/`(分组分段)。owner 不存在 / slug 不存在 / 非 public 都 404。
// robots.txt + sitemap.xml 是真 SEO,仍在 seo.go。handler 方法挂在 SEOHandlers 上
// (共用 Deps),命名的完整 SEO→landing 归一留后续一轮。

package public

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/apierr"
	"github.com/atmaxmoj/standmeet/internal/corpusdomain"
	"github.com/atmaxmoj/standmeet/internal/ownerdomain"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

func (h *SEOHandlers) getWikiLanding() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		slug := chi.URLParam(r, "*")
		// F-L-11 bearer-aware reader: a valid code bearer reads in-scope gated entries; anonymous
		// (no/dead token) → published-only (SEO). Same scope predicate the wiki-tree/context use.
		token, _ := bearerToken(r)
		scope := usecases.WikiTreeScopeFor(r.Context(), h.Sessions, token)
		view, err := loadWikiLandingView(r.Context(), h.Deps, slug, scope)
		if err != nil {
			handleLandingErr(h.Log, w, err)
			return
		}
		writeJSONWikiLanding(h.Log, w, &view)
	}
}

type wikiRefView struct {
	Title string `json:"title"`
	Path  string `json:"path"`
}

type wikiLandingView struct {
	Path       string        `json:"path"`
	Title      string        `json:"title"`
	Body       string        `json:"body"`
	Excerpt    string        `json:"excerpt"`
	UpdatedAt  string        `json:"updated_at"`
	Tags       []string      `json:"tags"`
	CSSClasses []string      `json:"css_classes"` // per-note 呈现钩子;reader 加到 .corpus-content
	Related    []wikiRefView `json:"related"`
	CitedBy    []wikiRefView `json:"cited_by"`
	// SourcesCount —— 这条 wiki 是从几条 raw 提炼来的(N corpus sources)。
	SourcesCount int `json:"sources_count"`
}

func loadWikiLandingView(
	ctx context.Context, deps usecases.SEODeps, slug string, scope usecases.WikiTreeScope,
) (wikiLandingView, error) {
	res, err := usecases.GetWikiLanding(ctx, deps, slug, scope)
	if err != nil {
		return wikiLandingView{}, err
	}
	return wikiLandingView{
		Path:         slug,
		Title:        res.Wiki.Title(),
		Body:         res.Body,
		Excerpt:      res.Wiki.Excerpt(),
		UpdatedAt:    res.Wiki.UpdatedAt().UTC().Format(time.RFC3339),
		Tags:         res.Wiki.Tags(),
		CSSClasses:   res.Wiki.CSSClasses(),
		Related:      toWikiRefViews(res.Related),
		CitedBy:      toWikiRefViews(res.CitedBy),
		SourcesCount: len(res.Wiki.SourceRawIDs()),
	}, nil
}

func toWikiRefViews(refs []usecases.WikiPathTitle) []wikiRefView {
	out := make([]wikiRefView, 0, len(refs))
	for i := range refs {
		out = append(out, wikiRefView{Title: refs[i].Title, Path: refs[i].Path})
	}
	return out
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
	corpusdomain.ErrWikiNotFound,
	corpusdomain.ErrOutputNotFound,
	ownerdomain.ErrOwnerNotFound,
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
	Path      string `json:"path"`
	Title     string `json:"title"`
	Body      string `json:"body"`
	Excerpt   string `json:"excerpt"`
	UpdatedAt string `json:"updated_at"`
}

func loadOutputLandingView(
	ctx context.Context, deps usecases.SEODeps, slug string,
) (outputLandingView, error) {
	out, err := usecases.GetOutputLanding(ctx, deps, slug)
	if err != nil {
		return outputLandingView{}, err
	}
	return outputLandingView{
		Path:      slug,
		Title:     out.Title(),
		Body:      out.Body(),
		Excerpt:   out.Excerpt(),
		UpdatedAt: out.UpdatedAt().UTC().Format(time.RFC3339),
	}, nil
}

func writeJSONOutputLanding(log *slog.Logger, w http.ResponseWriter, view *outputLandingView) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(view); err != nil {
		log.Error("encode output landing", "err", err)
	}
}
