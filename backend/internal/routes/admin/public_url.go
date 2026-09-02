// public_url.go — PATCH /api/admin/public-url: the owner changes the deployment's
// canonical public URL (when changing domains after claim).
//
// owner.public_url is the single source for QR / canonical links. Capability comes from
// the outbound convergence point.

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// PublicURLDeps — capability source for the admin public-url endpoint.
type PublicURLDeps struct {
	Face *dispatcher.Face
}

// MountPublicURL mounts PATCH /public-url (caller prefix /api/admin).
func (h *Handlers) MountPublicURL(r chi.Router) {
	r.Patch("/public-url",
		h.dispatchOp(h.PublicURLAdmin.Face, "page.set_public_url", bodyArgs, jsonOK))
}
