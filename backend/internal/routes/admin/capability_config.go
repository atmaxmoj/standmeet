// capability_config.go — /api/admin/capabilities/{id}/config: the settable fields for
// **any** capability.
//
//	GET   /api/admin/capabilities/config          → which capabilities have settable fields
//	GET   /api/admin/capabilities/{id}/config     → that capability's fields (declaration
//	                                                 + current value + default value)
//	PATCH /api/admin/capabilities/{id}/config     → write it back
//
// This is the generic slot the panel leaves for capabilities. **No capability's name
// appears in this file**: the fields are declared in the capability's own manifest, and
// the panel renders by type. Before this, every settable capability needed its own
// hand-written route set + form in admin (that's how the booker's booking policy came
// about, and it later drifted from the sandboxed copy).

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// CapabilityConfigAdminDeps — capability source for admin's generic config facade.
type CapabilityConfigAdminDeps struct {
	Face *dispatcher.Face
}

// MountCapabilityConfig mounts the generic config facade (caller prefix /api/admin).
func (h *Handlers) MountCapabilityConfig(r chi.Router) {
	face := h.CapabilityConfigAdmin.Face
	r.Route("/capabilities/config", func(r chi.Router) {
		r.Get("/", h.dispatchOp(face, "capability_config.list", emptyArgs, jsonOK))
	})
	r.Get("/capabilities/{capability_id}/config",
		h.dispatchOp(face, "capability_config.get", urlParamArgs("capability_id"), jsonOK))
	r.Patch("/capabilities/{capability_id}/config",
		h.dispatchOp(face, "capability_config.set",
			bodyWithURLParam("capability_id"), jsonOK))
}
