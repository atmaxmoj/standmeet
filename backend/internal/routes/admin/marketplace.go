// marketplace.go —— admin GET /api/admin/marketplace/search?q=&source=.
// v1 surface is search-only; install / SKILL.md retrieval land in a
// later phase (frontend still simulates install in client state).

package admin

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// MarketplaceAdminDeps —— the slice of MarketplaceDeps the admin route
// needs. We re-declare instead of importing usecases.MarketplaceDeps
// directly so the route file stays a thin handler.
type MarketplaceAdminDeps struct {
	Deps usecases.MarketplaceDeps
}

// MountMarketplace —— GET /search → JSON array of MarketSkill.
func (h *Handlers) MountMarketplace(r chi.Router) {
	r.Route("/marketplace", func(r chi.Router) {
		r.Get("/search", h.marketplaceSearch())
	})
}

func (h *Handlers) marketplaceSearch() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query().Get("q")
		source := r.URL.Query().Get("source")
		items := usecases.SearchMarketplace(r.Context(), h.MarketplaceAdmin.Deps, q, source)
		writeMarketplace(h.Log, w, items)
	}
}

func writeMarketplace(
	log *slog.Logger, w http.ResponseWriter, items []domain.MarketSkill,
) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(items); err != nil {
		log.Error("encode marketplace", "err", err)
	}
}
