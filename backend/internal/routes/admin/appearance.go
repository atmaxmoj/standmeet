// appearance.go — admin /appearance/css: read/write for the owner's custom CSS.
//
// On write it goes through the domain's SetOwnerCSS sanitize + scope before landing in the
// DB; the read returns that sanitized version.
// All three owner-CSS facades (admin UI / MCP / vault sync) write to the same place
// (owners.custom_css).
//
// Capability comes from the outbound convergence point (shared plumbing in dispatch.go).
// PUT now also returns a payload — the CSS **as it landed after storage**, so the caller
// sees what actually took effect instead of just echoing what it sent.

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// AppearanceAdminDeps — capability source for the admin appearance handlers.
type AppearanceAdminDeps struct {
	Face *dispatcher.Face
}

// MountAppearance — the /appearance subrouter.
func (h *Handlers) MountAppearance(r chi.Router) {
	face := h.AppearanceAdmin.Face
	r.Route("/appearance", func(r chi.Router) {
		r.Get("/css", h.dispatchOp(face, "appearance.get_css", emptyArgs, jsonOK))
		r.Put("/css", h.dispatchOp(face, "set_owner_css", bodyArgs, jsonOK))
	})
}
