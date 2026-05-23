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

// MountSEO 挂 /seo + /wiki/{id}/seo + /output/{id}/seo。
func (h *Handlers) MountSEO(r chi.Router) {
	r.Get("/seo", h.getSEOSettings())
	r.Put("/seo", h.putSEOSettings())
	r.Patch("/wiki/{id}/seo", h.patchWikiSEO())
	r.Patch("/output/{id}/seo", h.patchOutputSEO())
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
	Path           *string `json:"path"`
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
		updated, err := h.SEOAdmin.SEO.UpdateWikiPath(
			r.Context(), wikiID, normalizePath(req.Path), req.SEODescription, req.SEOIndexed,
		)
		if err != nil {
			handleWikiSEOErr(h.Log, w, err)
			return
		}
		writeWikiSEOResp(h.Log, w, &updated)
	}
}

func normalizePath(s *string) *string {
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
	case errors.Is(err, domain.ErrPathTaken):
		writeError(log, w, apierr.Envelope{
			Status: http.StatusConflict, Code: "path_taken", Message: "path already in use",
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
	Path           *string `json:"path"`
	SEODescription string  `json:"seo_description"`
	SEOIndexed     bool    `json:"seo_indexed"`
}

func writeWikiSEOResp(log *slog.Logger, w http.ResponseWriter, wiki *domain.WikiEntry) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	resp := wikiSEOResp{
		ID:             wiki.ID,
		Path:           wiki.Path,
		SEODescription: wiki.SEODescription,
		SEOIndexed:     wiki.SEOIndexed,
	}
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Error("encode wiki seo resp", "err", err)
	}
}

// patchOutputSEO —— 同 patchWikiSEO 同 shape，给 output_entries 用。
func (h *Handlers) patchOutputSEO() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		outputID := chi.URLParam(r, "id")
		var req patchWikiSEORequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		updated, err := h.SEOAdmin.SEO.UpdateOutputPath(
			r.Context(), outputID, normalizePath(req.Path), req.SEODescription, req.SEOIndexed,
		)
		if err != nil {
			handleOutputSEOErr(h.Log, w, err)
			return
		}
		writeOutputSEOResp(h.Log, w, &updated)
	}
}

func handleOutputSEOErr(log *slog.Logger, w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrPathTaken):
		writeError(log, w, apierr.Envelope{
			Status: http.StatusConflict, Code: "path_taken", Message: "path already in use",
		})
	case errors.Is(err, domain.ErrOutputNotFound):
		writeError(log, w, apierr.Envelope{
			Status:  http.StatusNotFound,
			Code:    "output_not_found",
			Message: "output entry not found",
		})
	default:
		log.Error("patch output seo", logKeyErr, err)
		writeError(log, w, serverErr())
	}
}

// logKeyErr —— slog "err" 字面在 seo.go 多处出现，提常量。
const logKeyErr = "err"

func writeOutputSEOResp(log *slog.Logger, w http.ResponseWriter, out *domain.OutputEntry) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	resp := wikiSEOResp{
		ID:             out.ID,
		Path:           out.Path,
		SEODescription: out.SEODescription,
		SEOIndexed:     out.SEOIndexed,
	}
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Error("encode output seo resp", logKeyErr, err)
	}
}
