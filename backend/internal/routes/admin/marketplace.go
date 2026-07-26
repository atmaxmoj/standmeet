// marketplace.go —— admin marketplace routes: GET /search?q=&source= + POST /install +
// /install-manual. Install + SKILL.md retrieval shipped (#48-3); nothing is simulated client-side.

package admin

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/apierr"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/marketplace"
	"github.com/atmaxmoj/standmeet/internal/middleware"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// MarketplaceAdminDeps —— the slice of MarketplaceDeps the admin route
// needs. We re-declare instead of importing usecases.MarketplaceDeps
// directly so the route file stays a thin handler.
type MarketplaceAdminDeps struct {
	Deps usecases.MarketplaceDeps
}

// MountMarketplace —— GET /search → JSON array of MarketSkill; POST /install
// fetches the SKILL.md and persists it as a real skill (#48-3).
func (h *Handlers) MountMarketplace(r chi.Router) {
	r.Route("/marketplace", func(r chi.Router) {
		r.Get("/search", h.marketplaceSearch())
		r.Post("/install", h.marketplaceInstall())
		r.Post("/install-manual", h.marketplaceInstallManual())
	})
}

type installSkillRequest struct {
	Source    string `json:"source"`
	ID        string `json:"id"`
	SourceURL string `json:"source_url"`
	Name      string `json:"name"`
	Version   string `json:"version"`
}

type installManualRequest struct {
	SkillMD string `json:"skill_md"`
	Name    string `json:"name"` // optional display-name fallback
}

// marketplaceInstallManual —— install a SKILL.md the owner pasted from anywhere (no
// marketplace, no network). Parses frontmatter + body, persists as source='manual'.
func (h *Handlers) marketplaceInstallManual() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req installManualRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		ownerID := middleware.OwnerIDFrom(r.Context())
		skill, err := usecases.InstallManualSkill(r.Context(), usecases.InstallSkillDeps{
			Marketplace: h.MarketplaceAdmin.Deps.Client, Skills: h.SkillsAdmin.Skills.Skills,
		}, ownerID, req.SkillMD, req.Name)
		if err != nil {
			handleInstallSkillErr(h.Log, w, err)
			return
		}
		writeCreatedSkill(h.Log, w, &skill)
	}
}

func (h *Handlers) marketplaceInstall() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req installSkillRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		ownerID := middleware.OwnerIDFrom(r.Context())
		skill, err := usecases.InstallSkill(r.Context(), usecases.InstallSkillDeps{
			Marketplace: h.MarketplaceAdmin.Deps.Client, Skills: h.SkillsAdmin.Skills.Skills,
		}, &usecases.InstallSkillInput{
			OwnerID: ownerID, Source: req.Source, ID: req.ID,
			SourceURL: req.SourceURL, Name: req.Name, Version: req.Version,
		})
		if err != nil {
			handleInstallSkillErr(h.Log, w, err)
			return
		}
		writeCreatedSkill(h.Log, w, &skill)
	}
}

func handleInstallSkillErr(log *slog.Logger, w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, usecases.ErrEmptyField):
		writeError(log, w, envBadReq("source, id, and a non-empty SKILL.md are required"))
	case errors.Is(err, domain.ErrSkillNameTaken):
		writeError(log, w, apierr.Envelope{
			Status: http.StatusConflict, Code: "skill_name_taken",
			Message: "a skill with that name is already installed",
		})
	default:
		log.Error("install skill", "err", err)
		writeError(log, w, apierr.Envelope{
			Status: http.StatusBadGateway, Code: "install_failed",
			Message: "could not fetch or parse the skill — check the source.",
		})
	}
}

const (
	marketDefaultLimit = 24
	marketParseBase    = 10
	marketParseWidth   = 32
)

func (h *Handlers) marketplaceSearch() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		items := usecases.SearchMarketplace(r.Context(), h.MarketplaceAdmin.Deps,
			usecases.MarketSearchParams{
				Query:  q.Get("q"),
				Source: q.Get("source"),
				Limit:  parseIntDefault(q.Get("limit"), marketDefaultLimit),
				Offset: parseIntDefault(q.Get("offset"), 0),
			})
		writeMarketplace(h.Log, w, items)
	}
}

func parseIntDefault(s string, def int) int {
	n, err := strconv.ParseInt(s, marketParseBase, marketParseWidth)
	if err != nil {
		return def
	}
	return int(n)
}

func writeMarketplace(
	log *slog.Logger, w http.ResponseWriter, items []marketplace.MarketSkill,
) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(items); err != nil {
		log.Error("encode marketplace", "err", err)
	}
}
