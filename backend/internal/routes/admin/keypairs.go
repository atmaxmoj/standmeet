// keypairs.go —— /api/admin/keypairs: list / create (the private key is returned once) / delete.
// The ops are declared in the owner domain (internal/owner/ops/keypairs.go), panel-only; this
// facade only decides the REST shape.

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// KeypairsAdminDeps — op source for the admin keypairs handlers.
type KeypairsAdminDeps struct {
	Face *dispatcher.Face
}

// MountKeypairs mounts the /api/admin/keypairs subrouter.
func (h *Handlers) MountKeypairs(r chi.Router) {
	face := h.KeypairsAdmin.Face
	r.Get("/", h.dispatchOp(face, "keypairs.list", emptyArgs, jsonOK))
	r.Post("/", h.dispatchOp(face, "keypairs.create", bodyArgs, jsonCreated))
	r.Delete("/{key_id}", h.dispatchOp(face, "keypairs.delete", urlParamArgs("key_id"), noContent))
}
