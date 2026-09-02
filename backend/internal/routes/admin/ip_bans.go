// ip_bans.go — /api/admin/ip-bans/* — lets the owner view / add / remove banned IPs
// (#58-4). Enforcement on the public facade goes through middleware.BanGuard (elsewhere);
// this is just the owner's CRUD. Works with conversations.client_ip's "IP awareness":
// the owner sees the source IP in a conversation → comes here to ban it.
//
// **The first admin route wired from the outbound convergence point.** The route shape,
// method, path, parameter placement are all still hand-written as before — what REST
// looks like is this facade's own decision. What changes is where the capability comes
// from: the handler no longer holds security's repository, it takes an Op from the
// dispatcher's admin Face instead (shared plumbing in dispatch.go). As a result:
//
//   - business logic and validation exist in one copy (at the convergence point); MCP's
//     facade gets the same Op, so there's no separate copy on each side;
//   - "which capability does this route serve" is a fact recorded by the convergence
//     point (taking it registers it), so parity is answered by structure, no more
//     hand-written cross-reference table to reconcile after the fact.

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// IPBansAdminDeps — capability source for admin ip-bans: the outbound convergence
// point's admin Face. No longer a repository: this facade shouldn't reach the domain
// directly.
type IPBansAdminDeps struct {
	Face *dispatcher.Face
}

// MountIPBans mounts the /ip-bans/* subrouter.
func (h *Handlers) MountIPBans(r chi.Router) {
	face := h.IPBansAdmin.Face
	r.Route("/ip-bans", func(r chi.Router) {
		r.Get("/", h.dispatchOp(face, "ip_bans.list", emptyArgs, jsonOK))
		r.Post("/", h.dispatchOp(face, "ip_bans.add", bodyArgs, jsonOK))
		r.Delete("/{id}", h.dispatchOp(face, "ip_bans.remove", urlParamArgs("id"), jsonOK))
	})
}
