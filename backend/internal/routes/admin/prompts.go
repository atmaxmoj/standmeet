// prompts.go — /api/admin/prompts CRUD.
//
// Capability comes from the outbound convergence point (shared plumbing in dispatch.go);
// this facade only decides the REST shape: create returns 201, everything else returns
// 200, the resource id goes in the path.
//
// The outbound payload is the same one MCP's facade uses — before the migration, MCP's
// prompt_list **carried no body**, so listing from Claude Code showed the owner none of
// what they'd written; now there's only one shape.

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// PromptsAdminDeps — capability source for the admin prompts handlers.
type PromptsAdminDeps struct {
	Face *dispatcher.Face
}

// MountPrompts mounts the /prompts subrouter.
func (h *Handlers) MountPrompts(r chi.Router) {
	face := h.PromptsAdmin.Face
	r.Route("/prompts", func(r chi.Router) {
		r.Get("/", h.dispatchOp(face, "prompt_list", emptyArgs, jsonOK))
		r.Post("/", h.dispatchOp(face, "prompt_create", bodyArgs, jsonCreated))
		r.Get("/{prompt_id}",
			h.dispatchOp(face, "prompts.get", urlParamArgs("prompt_id"), jsonOK))
		r.Put("/{prompt_id}",
			h.dispatchOp(face, "prompt_update", bodyWithURLParam("prompt_id"), jsonOK))
		r.Delete("/{prompt_id}",
			h.dispatchOp(face, "prompt_delete", urlParamArgs("prompt_id"), jsonOK))
	})
}
