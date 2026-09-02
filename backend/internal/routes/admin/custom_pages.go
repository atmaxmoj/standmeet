// custom_pages.go — /api/admin/custom-pages: the owner's custom React pages.
//
// Read + **write**. The write group used to live only on MCP; the given exception was
// "the panel has no UI for this" — explaining the status quo with the status quo, and
// writing it somewhere the ratchet could read, so the gap stopped being reported from
// then on (see the comment in internal/owner/ops/custom_pages.go). Once the exception was
// removed, the convergence point names these eight routes by name at startup, and the
// server flatly refuses to boot until they're mounted.
//
// Capability comes from the outbound convergence point (shared plumbing in dispatch.go);
// this facade only decides the REST shape: create returns 201, everything else returns
// 200, the resource id goes in the path, everything else goes in the body.

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// CustomPagesDeps — capability source for the admin custom-pages handlers.
type CustomPagesDeps struct {
	Face *dispatcher.Face
}

// MountCustomPages mounts the /custom-pages subrouter.
func (h *Handlers) MountCustomPages(r chi.Router) {
	face := h.CustomPagesAdmin.Face
	r.Route("/custom-pages", func(r chi.Router) {
		r.Get("/", h.dispatchOp(face, "custom_page.list", emptyArgs, jsonOK))
		r.Post("/", h.dispatchOp(face, "custom_page.create", bodyArgs, jsonCreated))
		r.Get("/builds/{build_id}",
			h.dispatchOp(face, "custom_page.get_build", urlParamArgs("build_id"), jsonOK))
		h.mountCustomPageItem(r, face)
	})
}

// mountCustomPageItem — the /{slug} group. slug goes in the path, everything else goes in
// the body, the same shape as the skills facade.
func (h *Handlers) mountCustomPageItem(r chi.Router, face *dispatcher.Face) {
	r.Route("/{slug}", func(r chi.Router) {
		r.Put("/files",
			h.dispatchOp(face, "custom_page.write_file", bodyWithURLParam("slug"), jsonOK))
		r.Post("/build", h.dispatchOp(face, "custom_page.build", urlParamArgs("slug"), jsonOK))
		r.Put("/byoai",
			h.dispatchOp(face, "custom_page.set_byoai", bodyWithURLParam("slug"), jsonOK))
		r.Post("/staging",
			h.dispatchOp(face, "custom_page.promote_to_staging", bodyWithURLParam("slug"), jsonOK))
		r.Post("/live",
			h.dispatchOp(face, "custom_page.promote_to_live", bodyWithURLParam("slug"), jsonOK))
		r.Post("/rollback",
			h.dispatchOp(face, "custom_page.rollback", urlParamArgs("slug"), jsonOK))
		r.Delete("/", h.dispatchOp(face, "custom_page.delete", urlParamArgs("slug"), jsonOK))
	})
}
