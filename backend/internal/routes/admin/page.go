// page.go — /api/admin/page*: the owner's public homepage.
//
// Capability comes from the outbound convergence point (shared plumbing in dispatch.go);
// this facade only decides the REST shape.
//
// Before the migration, the page this facade got was **bare**: insights/projects only
// carried an id, and the frontend had to assemble the title and excerpt itself; MCP's
// side got a joined version. Now both facades share the same one. "What can be pinned"
// also used to exist only here, with the rule (pinned ⊆ published) written into the
// handler — now it lives in the domain, and both facades can query it.

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// PageAdminDeps — capability source for the admin page handlers.
type PageAdminDeps struct {
	Face *dispatcher.Face
}

// MountPage mounts /page. The caller is responsible for the /api/admin/ prefix + auth
// middleware.
func (h *Handlers) MountPage(r chi.Router) {
	face := h.PageAdmin.Face
	r.Get("/page", h.dispatchOp(face, "page.get", emptyArgs, jsonOK))
	r.Put("/page", h.dispatchOp(face, "page.put", bodyArgs, jsonOK))
	r.Get("/page/pinnable", h.dispatchOp(face, "page.pinnable", emptyArgs, jsonOK))
	r.Post("/page/pin", h.dispatchOp(face, "page.pin", bodyArgs, jsonOK))
	r.Post("/page/unpin", h.dispatchOp(face, "page.unpin", bodyArgs, jsonOK))
}
