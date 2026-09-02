// mcp_servers.go — admin /mcp-servers: list / create / check / delete + dep-grant.
//
// Capability comes from the outbound convergence point (shared plumbing in dispatch.go).
// delete and dep-grant have historically returned 204 empty, the frontend is written
// against that contract, so they keep returning 204 — the status code is this facade's
// decision, the payload is the convergence point's.

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// MCPServersAdminDeps — capability source for the admin mcp-servers handlers.
type MCPServersAdminDeps struct {
	Face *dispatcher.Face
}

// MountMCPServers mounts /mcp-servers: owner-registered server CRUD; an mcp server
// attaches to a role through role_mcp_servers (as of A.3-IAM-5 it no longer attaches to
// a code directly).
func (h *Handlers) MountMCPServers(r chi.Router) {
	face := h.MCPServersAdmin.Face
	r.Route("/mcp-servers", func(r chi.Router) {
		r.Get("/", h.dispatchOp(face, "mcp_server_list", emptyArgs, jsonOK))
		r.Post("/", h.dispatchOp(face, "mcp_server_create", bodyArgs, jsonCreated))
		// POST rather than GET: this dials out. Read semantics (changes nothing), but
		// **expensive with a side effect**, so no layer should treat it as a cacheable,
		// prefetchable GET.
		r.Post("/{server_id}/check",
			h.dispatchOp(face, "mcp_server_check", urlParamArgs("server_id"), jsonOK))
		r.Delete("/{server_id}",
			h.dispatchOp(face, "mcp_server_delete", urlParamArgs("server_id"), noContent))
		// The owner explicitly authorizes this ext-mcp server to use a connector
		// dependency (minimum trust, denied by default).
		r.Post("/{server_id}/dep-grants",
			h.dispatchOp(face, "mcp_server_grant_dep",
				bodyWithURLParam("server_id"), noContent))
	})
}
