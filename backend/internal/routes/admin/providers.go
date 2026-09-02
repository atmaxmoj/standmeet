// providers.go — admin /providers: the owner's provider notebook (create/edit/delete +
// mark default).
//
// The neighboring /ai-provider talks about **the default entry** (the setup wizard,
// claim, and that old form all go through it); this file manages the notebook itself.
// Both routes write to the same table.
//
// Creating an entry carries the plaintext key, so like ai_provider.set it lives only on
// this facade; the response carries no key — the outbound type on the convergence point
// side never has that field at all.

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// ProvidersAdminDeps — capability source for the route.
type ProvidersAdminDeps struct {
	Face *dispatcher.Face
}

// MountProviders mounts the /providers group.
func (h *Handlers) MountProviders(r chi.Router) {
	face := h.ProvidersAdmin.Face
	r.Route("/providers", func(r chi.Router) {
		// The list returns a **bare array** (the frontend's provider notebook maps it
		// directly) with no wrapper — this facade has precedent for both shapes, so it
		// picks whichever is least work for the caller.
		r.Get("/", h.dispatchOp(face, "providers.list", emptyArgs, jsonOK))
		r.Post("/", h.dispatchOp(face, "providers.create", bodyArgs, jsonCreated))
		r.Patch("/{id}",
			h.dispatchOp(face, "providers.update", bodyWithURLParam("id"), jsonOK))
		r.Delete("/{id}",
			h.dispatchOp(face, "providers.delete", urlParamArgs("id"), noContent))
		r.Post("/{id}/default",
			h.dispatchOp(face, "providers.set_default", urlParamArgs("id"), jsonOK))
		// models — "which models does this provider have". **The owner's facade carries
		// no key**: the server queries using the one already stored in the database
		// (F-R-11). The visitor route (`/api/v1/inference/models`) is the reverse — the
		// key travels with the request, because that route has no auth and the caller
		// is the key's holder.
		r.Post("/{id}/models",
			h.dispatchOp(face, "providers.list_models", urlParamArgs("id"), jsonOK))
		r.Post("/models", h.dispatchOp(face, "providers.list_models", emptyArgs, jsonOK))
	})
}
