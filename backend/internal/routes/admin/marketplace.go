// marketplace.go — admin marketplace routes: GET /search + POST /install +
// /install-manual.
//
// Capability comes from the outbound convergence point (shared plumbing in dispatch.go).
// What gets installed is a skill, and the payload shape is the same one /skills uses —
// at the convergence point, marketplace and skills share skillRow.

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// MarketplaceAdminDeps — capability source for the admin marketplace handlers.
type MarketplaceAdminDeps struct {
	Face *dispatcher.Face
}

// MountMarketplace — GET /search lists marketplace results; POST /install fetches a
// SKILL.md and turns it into a real skill; /install-manual accepts a SKILL.md the owner
// pasted in by hand.
func (h *Handlers) MountMarketplace(r chi.Router) {
	face := h.MarketplaceAdmin.Face
	r.Route("/marketplace", func(r chi.Router) {
		r.Get("/search", h.dispatchOp(face, "marketplace.search",
			queryArgsRenamed(map[string]string{"q": "query", "source": "source"},
				"limit", "offset"), jsonOK))
		r.Post("/install", h.dispatchOp(face, "marketplace.install", bodyArgs, jsonCreated))
		r.Post("/install-manual",
			h.dispatchOp(face, "marketplace.install_manual", bodyArgs, jsonCreated))
	})
}
