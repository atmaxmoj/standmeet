// skills.go — /api/admin/skills CRUD (#48-2).
//
// Capability comes from the outbound convergence point (shared plumbing in dispatch.go);
// this facade only decides the REST shape: create returns 201, everything else returns
// 200, the resource id goes in the path, everything else goes in the body.
//
// The outbound payload is the same one MCP's facade uses — before the migration, MCP's
// skill_list was missing allowed_tools / enabled, so the owner couldn't tell from Claude
// Code whether a skill was turned off; now there's only one shape.

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// SkillsAdminDeps — capability source for the admin skills handlers.
type SkillsAdminDeps struct {
	Face *dispatcher.Face
}

// MountSkills mounts the /skills subrouter.
func (h *Handlers) MountSkills(r chi.Router) {
	face := h.SkillsAdmin.Face
	r.Route("/skills", func(r chi.Router) {
		r.Get("/", h.dispatchOp(face, "skill_list", emptyArgs, jsonOK))
		r.Post("/", h.dispatchOp(face, "skill_create", bodyArgs, jsonCreated))
		r.Patch("/{skill_id}",
			h.dispatchOp(face, "skill_set_enabled", bodyWithURLParam("skill_id"), jsonOK))
		// PUT replaces this skill's body and which tools it can call. The PATCH route
		// only manages the enabled bit. The two are kept separate because their inputs
		// and failure modes differ (a rename can collide with a unique constraint, the
		// toggle can't).
		r.Put("/{skill_id}",
			h.dispatchOp(face, "skill_update", bodyWithURLParam("skill_id"), jsonOK))
		r.Delete("/{skill_id}",
			h.dispatchOp(face, "skill_delete", urlParamArgs("skill_id"), jsonOK))
	})
}
