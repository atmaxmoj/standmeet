// roles.go — /api/admin/roles CRUD.
//
// Capability comes from the outbound convergence point (shared plumbing in dispatch.go);
// this facade only decides the REST shape: create returns 201, everything else returns
// 200, the resource id goes in the path, everything else goes in the body.
//
// The outbound payload is the same one MCP's facade uses. Before the migration this was
// the resource with the biggest drift: MCP's role_list only gave the **count** of
// skill/mcp, and role_update couldn't even accept waypoints / dock_buttons /
// require_ghost_evidence — meaning the owner could neither see nor change a
// security-relevant per-role switch like require_ghost_evidence from Claude Code.

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// RolesAdminDeps — capability source for the admin roles handlers.
type RolesAdminDeps struct {
	Face *dispatcher.Face
}

// MountRoles mounts the /roles subrouter.
func (h *Handlers) MountRoles(r chi.Router) {
	face := h.RolesAdmin.Face
	r.Route("/roles", func(r chi.Router) {
		r.Get("/", h.dispatchOp(face, "role_list", emptyArgs, jsonOK))
		r.Post("/", h.dispatchOp(face, "role_create", bodyArgs, jsonCreated))
		r.Get("/{role_id}", h.dispatchOp(face, "roles.get", urlParamArgs("role_id"), jsonOK))
		r.Put("/{role_id}",
			h.dispatchOp(face, "role_update", bodyWithURLParam("role_id"), jsonOK))
		r.Delete("/{role_id}",
			h.dispatchOp(face, "role_delete", urlParamArgs("role_id"), noContent))
	})
}
