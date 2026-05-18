// seo.go —— /api/admin/seo (settings) + PATCH /api/admin/wiki/{id}/seo。
// 都要 owner session。

package admin

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/wangsijie/standmeet/internal/apierr"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/middleware"
	"github.com/wangsijie/standmeet/internal/postgres"
)

// SEOAdminDeps —— admin SEO handlers 依赖。
type SEOAdminDeps struct {
	SEO *postgres.SEORepo
}

// MountSEO 挂 /seo + /wiki/{id}/seo（caller 已经在 /api/admin 下 + auth 包过）。
func (h *Handlers) MountSEO(r chi.Router) {
	r.Get("/seo", h.getSEOSettings())
	r.Put("/seo", h.putSEOSettings())
	r.Patch("/wiki/{id}/seo", h.patchWikiSEO())
}

// 字段顺序按 govet fieldalignment：string + slice 在前，bool 末尾。
type seoSettingsView struct {
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
		saved, err := h.SEOAdmin.SEO.UpsertSettings(r.Context(), &domain.SEOSettings{
			OwnerID:       ownerID,
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

func writeSEOSettings(log *slog.Logger, w http.ResponseWriter, settings *domain.SEOSettings) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	view := seoSettingsView{
		IndexRobots:   settings.IndexRobots,
		SitemapExtras: settings.SitemapExtras,
		OGTemplate:    settings.OGTemplate,
	}
	if err := json.NewEncoder(w).Encode(view); err != nil {
		log.Error("encode seo settings", "err", err)
	}
}

type patchWikiSEORequest struct {
	SEOSlug        *string `json:"seo_slug"`
	SEODescription string  `json:"seo_description"`
	SEOIndexed     bool    `json:"seo_indexed"`
}

func (h *Handlers) patchWikiSEO() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		wikiID := chi.URLParam(r, "id")
		var req patchWikiSEORequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		updated, err := h.SEOAdmin.SEO.UpdateWikiSEO(
			r.Context(), wikiID, normalizeSlug(req.SEOSlug), req.SEODescription, req.SEOIndexed,
		)
		if err != nil {
			handleWikiSEOErr(h.Log, w, err)
			return
		}
		writeWikiSEOResp(h.Log, w, &updated)
	}
}

func normalizeSlug(s *string) *string {
	if s == nil {
		return nil
	}
	if *s == "" {
		return nil
	}
	return s
}

func handleWikiSEOErr(log *slog.Logger, w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrSlugTaken):
		writeError(log, w, apierr.Envelope{
			Status: http.StatusConflict, Code: "slug_taken", Message: "slug already in use",
		})
	case errors.Is(err, domain.ErrWikiNotFound):
		writeError(log, w, apierr.Envelope{
			Status: http.StatusNotFound, Code: "wiki_not_found", Message: "wiki entry not found",
		})
	default:
		log.Error("patch wiki seo", "err", err)
		writeError(log, w, serverErr())
	}
}

type wikiSEOResp struct {
	ID             string  `json:"id"`
	SEOSlug        *string `json:"seo_slug"`
	SEODescription string  `json:"seo_description"`
	SEOIndexed     bool    `json:"seo_indexed"`
}

func writeWikiSEOResp(log *slog.Logger, w http.ResponseWriter, wiki *domain.WikiEntry) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	resp := wikiSEOResp{
		ID:             wiki.ID,
		SEOSlug:        wiki.SEOSlug,
		SEODescription: wiki.SEODescription,
		SEOIndexed:     wiki.SEOIndexed,
	}
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Error("encode wiki seo resp", "err", err)
	}
}
