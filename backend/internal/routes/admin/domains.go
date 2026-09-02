// domains.go — /api/admin/allowed-domains CRUD (list + add + remove).
// The actual DNS / TLS verification goes through /internal/tls-ask (Caddy's on-demand
// TLS path). This file only maintains the instance_settings.allowed_domains jsonb array.
//
// Capability comes from the outbound convergence point (shared plumbing in dispatch.go);
// the route shape is still this facade's own decision — add / remove have historically
// returned 204 empty, the frontend is written against that contract, so they keep
// returning 204.

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// DomainsDeps — capability source for the admin domains handlers.
type DomainsDeps struct {
	Face *dispatcher.Face
}

// MountDomains mounts the /allowed-domains subrouter.
func (h *Handlers) MountDomains(r chi.Router) {
	face := h.Domains.Face
	r.Get("/allowed-domains", h.dispatchOp(face, "domains.list", emptyArgs, jsonOK))
	r.Post("/allowed-domains", h.dispatchOp(face, "domains.add", bodyArgs, noContent))
	r.Delete("/allowed-domains/{domain}",
		h.dispatchOp(face, "domains.remove", urlParamArgs("domain"), noContent))
}
