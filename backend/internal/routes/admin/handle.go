// handle.go — PATCH /api/admin/handle: the owner changes their URL handle.
//
// Capability comes from the outbound convergence point; the old handle automatically
// landing in handle_aliases is the domain's business (old links still resolve).

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// HandleDeps — capability source for the admin handle endpoint.
type HandleDeps struct {
	Face *dispatcher.Face
}

// MountHandle mounts PATCH /handle (caller prefix /api/admin).
func (h *Handlers) MountHandle(r chi.Router) {
	r.Patch("/handle", h.dispatchOp(h.HandleAdmin.Face, "page.set_handle", bodyArgs, jsonOK))
}
