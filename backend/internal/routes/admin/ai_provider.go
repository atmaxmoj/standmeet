// ai_provider.go — admin /ai-provider: lets the owner set their own inference provider +
// plaintext key (AES-GCM encrypted before it hits disk), plus the built-in preset list
// (fills the dropdown + default endpoint/model).
//
// Capability comes from the outbound convergence point (shared plumbing in dispatch.go).
// The response has no key — the type on the convergence side never has this field at all,
// so no facade can leak it; it's not this file remembering not to write it.
//
// The write is a **deliberate single-facade decision**: it carries the raw secret key, and
// MCP is a pure JSON tool facade that doesn't carry that. presets is read-only, on both facades.

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// AIProviderDeps — capability source for the admin ai-provider route.
type AIProviderDeps struct {
	Face *dispatcher.Face
}

// MountAIProvider mounts PATCH /ai-provider + GET /ai-provider/presets.
func (h *Handlers) MountAIProvider(r chi.Router) {
	face := h.AIProviderAdmin.Face
	r.Patch("/ai-provider", h.dispatchOp(face, "ai_provider.set", bodyArgs, jsonOK))
	r.Get("/ai-provider/presets",
		h.dispatchOp(face, "ai_provider.presets", emptyArgs, jsonOK))
}
