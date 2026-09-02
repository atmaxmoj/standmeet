// access_requests.go — admin /access-requests endpoint (list + status update + approve).
//
// Capability comes from the outbound convergence point (shared plumbing in dispatch.go);
// this facade only decides the REST shape: status filter goes in the query, the resource id
// goes in the path, everything else goes in the body.
// Error-to-status-code translation also lives in this facade: the convergence point only
// says "caller's fault / not found / our fault".

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// AccessRequestsDeps — capability source for the admin access-requests handlers.
type AccessRequestsDeps struct {
	Face *dispatcher.Face
}

// MountAccessRequests mounts the /access-requests subrouter.
func (h *Handlers) MountAccessRequests(r chi.Router) {
	face := h.AccessRequests.Face
	r.Get("/access-requests",
		h.dispatchOp(face, "access_requests.list", queryArgs("status"), jsonOK))
	r.Patch("/access-requests/{id}",
		h.dispatchOp(face, "access_requests.update", bodyWithURLParam("id"), jsonOK))
	r.Post("/access-requests/{id}/approve",
		h.dispatchOp(face, "access_requests.approve", urlParamArgs("id"), jsonOK))
}
