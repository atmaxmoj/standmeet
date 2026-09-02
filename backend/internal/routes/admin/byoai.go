// byoai.go — PUT /api/admin/byoai. The owner writes three fields at once: enabled /
// providers / blurb.
//
// Capability comes from the outbound convergence point (shared plumbing in dispatch.go).
// The response is the complete settings slice (ai + byoai), so the frontend can swap it
// straight into the cache — before the migration this path's response **was missing
// ai.endpoint and ai.model**, and one swap wiped those two fields blank; now both write
// paths and GET /me build off the same construction.

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// BYOAIDeps — capability source for the admin BYOAI handlers.
type BYOAIDeps struct {
	Face *dispatcher.Face
}

// MountBYOAI mounts PUT /byoai.
func (h *Handlers) MountBYOAI(r chi.Router) {
	r.Put("/byoai", h.dispatchOp(h.BYOAI.Face, "byoai.set", bodyArgs, jsonOK))
}
