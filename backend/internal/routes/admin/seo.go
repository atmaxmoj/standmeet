// seo.go —— /api/admin/seo (settings) + PATCH /api/admin/wiki/{id}/seo。
// 都要 owner session。

package admin

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/apierr"
	"github.com/atmaxmoj/standmeet/internal/corpusdomain"
	"github.com/atmaxmoj/standmeet/internal/middleware"
	"github.com/atmaxmoj/standmeet/internal/postgres"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// SEOAdminDeps —— admin SEO handlers 依赖。Pins 给 unpublish→auto-unpin 钩子
// (pinned ⊆ published 的 unpublish 端;必须走 UpdateWikiSEOWithPins)。
type SEOAdminDeps struct {
	SEO  *postgres.SEORepo
	Pins usecases.PagePinDeps
}

// MountSEO 挂 /seo + /seo/stats + 统一的 /corpus/{genre}/{id}/seo（合并原
// /wiki/{id}/seo + /output/{id}/seo —— genre 作路径参数）。
func (h *Handlers) MountSEO(r chi.Router) {
	r.Get("/seo", h.getSEOSettings())
	r.Put("/seo", h.putSEOSettings())
	r.Get("/seo/stats", h.getSEOStats())
	r.Patch("/corpus/{genre}/{id}/seo", h.byGenre(map[string]http.HandlerFunc{
		"wiki": h.patchWikiSEO(), "output": h.patchOutputSEO(),
	}))
}

// seoStatsView —— 各 tier 已公开条目数。owner 在 UI 选统计范围（默认全含），
// 范围是前端对这三个数求和的事，后端一律返全三个。
type seoStatsView struct {
	Wiki     int64 `json:"wiki"`
	Outputs  int64 `json:"outputs"`
	Writings int64 `json:"writings"`
}

func (h *Handlers) getSEOStats() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		counts, err := h.SEOAdmin.SEO.CountPublished(r.Context(), ownerID)
		if err != nil {
			h.Log.Error("admin seo stats", logKeyErr, err)
			writeError(h.Log, w, serverErr())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		view := seoStatsView{Wiki: counts.Wiki, Outputs: counts.Outputs, Writings: counts.Writings}
		if encErr := json.NewEncoder(w).Encode(view); encErr != nil {
			h.Log.Error("encode seo stats", logKeyErr, encErr)
		}
	}
}

// 字段顺序按 govet fieldalignment：string + slice 在前，bool 末尾。
// site_title = owner 自写的站点标题；og:description / canonical 不在此——它们
// 分别复用 page.tagline / owner.public_url（前端只读展示 + 跳转编辑）。
type seoSettingsView struct {
	SiteTitle     string   `json:"site_title"`
	OGTemplate    string   `json:"og_template"`
	SitemapExtras []string `json:"sitemap_extras"`
	IndexRobots   bool     `json:"index_robots"`
}

func (h *Handlers) getSEOSettings() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		settings, err := h.SEOAdmin.SEO.GetSettings(r.Context(), ownerID)
		if err != nil {
			h.Log.Error("admin get seo settings", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeSEOSettings(h.Log, w, &settings)
	}
}

func (h *Handlers) putSEOSettings() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		var body seoSettingsView
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		saved, err := h.SEOAdmin.SEO.UpsertSettings(r.Context(), &corpusdomain.SEOSettings{
			OwnerID:       ownerID,
			SiteTitle:     body.SiteTitle,
			IndexRobots:   body.IndexRobots,
			SitemapExtras: body.SitemapExtras,
			OGTemplate:    body.OGTemplate,
		})
		if err != nil {
			h.Log.Error("admin upsert seo settings", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeSEOSettings(h.Log, w, &saved)
	}
}

func writeSEOSettings(log *slog.Logger, w http.ResponseWriter, settings *corpusdomain.SEOSettings) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	view := seoSettingsView{
		SiteTitle:     settings.SiteTitle,
		IndexRobots:   settings.IndexRobots,
		SitemapExtras: settings.SitemapExtras,
		OGTemplate:    settings.OGTemplate,
	}
	if err := json.NewEncoder(w).Encode(view); err != nil {
		log.Error("encode seo settings", "err", err)
	}
}

// patchWikiSEORequest —— 地址树派生,owner 不设 path;只改 meta 描述 + indexed。
type patchWikiSEORequest struct {
	Excerpt   string `json:"excerpt"`
	Published bool   `json:"published"`
}

func (h *Handlers) patchWikiSEO() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		wikiID := chi.URLParam(r, "id")
		var req patchWikiSEORequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		res, err := usecases.UpdateWikiSEOWithPins(
			r.Context(), h.SEOAdmin.SEO, h.SEOAdmin.Pins, usecases.WikiSEOUpdate{
				OwnerID:     middleware.OwnerIDFrom(r.Context()),
				WikiID:      wikiID,
				Description: req.Excerpt,
				Published:   req.Published,
			},
		)
		if err != nil {
			handleWikiSEOErr(h.Log, w, err)
			return
		}
		writeWikiSEOResp(h.Log, w, &res.Wiki, res.Unpinned)
	}
}

func handleWikiSEOErr(log *slog.Logger, w http.ResponseWriter, err error) {
	if errors.Is(err, corpusdomain.ErrWikiNotFound) {
		writeError(log, w, apierr.Envelope{
			Status: http.StatusNotFound, Code: "wiki_not_found", Message: "wiki entry not found",
		})
		return
	}
	log.Error("patch wiki seo", "err", err)
	writeError(log, w, serverErr())
}

type wikiSEOResp struct {
	ID      string `json:"id"`
	Excerpt string `json:"excerpt"`
	// UnpinnedSections —— unpublish 自动摘 pin 的副作用声明(空 = 没 pin 过)。
	UnpinnedSections []string `json:"unpinned_sections"`
	Published        bool     `json:"published"`
}

func writeWikiSEOResp(
	log *slog.Logger, w http.ResponseWriter, wiki *corpusdomain.Wiki, unpinned []string,
) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	resp := wikiSEOResp{
		ID:               wiki.ID(),
		Excerpt:          wiki.Excerpt(),
		Published:        wiki.Published(),
		UnpinnedSections: emptyIfNil(unpinned),
	}
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Error("encode wiki seo resp", "err", err)
	}
}

func emptyIfNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// patchOutputSEO —— 同 patchWikiSEO 同 shape，给 output note 用。
func (h *Handlers) patchOutputSEO() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		outputID := chi.URLParam(r, "id")
		var req patchWikiSEORequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		updated, err := h.SEOAdmin.SEO.UpdateOutputSEO(
			r.Context(), middleware.OwnerIDFrom(r.Context()), outputID, req.Excerpt, req.Published,
		)
		if err != nil {
			handleOutputSEOErr(h.Log, w, err)
			return
		}
		writeOutputSEOResp(h.Log, w, &updated)
	}
}

func handleOutputSEOErr(log *slog.Logger, w http.ResponseWriter, err error) {
	if errors.Is(err, corpusdomain.ErrOutputNotFound) {
		writeError(log, w, apierr.Envelope{
			Status:  http.StatusNotFound,
			Code:    "output_not_found",
			Message: "output entry not found",
		})
		return
	}
	log.Error("patch output seo", logKeyErr, err)
	writeError(log, w, serverErr())
}

// logKeyErr —— slog "err" 字面在 seo.go 多处出现，提常量。
const logKeyErr = "err"

func writeOutputSEOResp(log *slog.Logger, w http.ResponseWriter, out *corpusdomain.Output) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	resp := wikiSEOResp{
		ID:        out.ID(),
		Excerpt:   out.Excerpt(),
		Published: out.Published(),
	}
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Error("encode output seo resp", logKeyErr, err)
	}
}
