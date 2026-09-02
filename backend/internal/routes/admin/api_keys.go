// api_keys.go — admin /api-keys endpoint (list / mint / revoke / edit label and rate limit).
//
// **Why this facade has to exist** (F-K-1): before it, outbound keys only lived on
// owner-MCP, so a leaked key **could only be revoked once the owner had installed and
// run an MCP client**. The bleeding-stop path can't require installing a tool first.
// The design always called for the two facades to be twins
// (`docs/design/facade-directions.md:202-206`: admin HTTP's `/api/admin/api-keys` CRUD +
// revoke, plus admin's api section) — this half was simply missing.
//
// Capability comes from the outbound convergence point (shared plumbing in dispatch.go);
// this facade only decides the REST shape: the resource id goes in the path, everything
// else goes in the body. Minting carries the **plaintext secret** exactly once —
// afterward only the prefix survives in the list.

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// APIKeysAdminDeps — capability source for the admin api-keys handlers.
type APIKeysAdminDeps struct {
	Face *dispatcher.Face
}

// MountAPIKeys mounts the /api-keys subrouter.
func (h *Handlers) MountAPIKeys(r chi.Router) {
	face := h.APIKeysAdmin.Face
	r.Get("/api-keys", h.dispatchOp(face, "api_keys.list", emptyArgs, jsonOK))
	r.Post("/api-keys", h.dispatchOp(face, "api_keys.create", bodyArgs, jsonOK))
	r.Patch("/api-keys/{id}", h.dispatchOp(face, "api_keys.update", bodyWithURLParam("id"), jsonOK))
	r.Post("/api-keys/{id}/revoke",
		h.dispatchOp(face, "api_keys.revoke", urlParamArgs("id"), jsonOK))
}
