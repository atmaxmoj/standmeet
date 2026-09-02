// capabilities.go — admin facade /api/admin/capabilities: the owner's "what can visitors
// use" panel.
//
//	GET    /api/admin/capabilities        → list everything (capability / connector / skill)
//	PATCH  /api/admin/capabilities/{id}   → {enabled} owner-enable toggle (builtins too)
//	DELETE /api/admin/capabilities/{id}   → only owner-origin can be deleted, else 4xx
//
// Capability comes from the outbound convergence point (shared plumbing in dispatch.go).
// origin decides existence (whether it's deletable); enabled decides availability
// (whether a visitor session assembles it) — both decisions live in the convergence point,
// only one copy.

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// CapabilityAdminDeps — capability source for the admin capabilities handlers.
type CapabilityAdminDeps struct {
	Face *dispatcher.Face
}

// MountCapabilities mounts the /capabilities subrouter.
func (h *Handlers) MountCapabilities(r chi.Router) {
	face := h.CapabilitiesAdmin.Face
	r.Route("/capabilities", func(r chi.Router) {
		r.Get("/", h.dispatchOp(face, "capabilities.list", emptyArgs, jsonOK))
		r.Patch("/{id}",
			h.dispatchOp(face, "capabilities.set_enabled", bodyWithURLParam("id"), jsonOK))
		r.Delete("/{id}",
			h.dispatchOp(face, "capabilities.delete", urlParamArgs("id"), jsonOK))
	})
}
