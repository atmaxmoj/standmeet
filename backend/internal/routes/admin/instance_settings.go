// instance_settings.go — /api/admin/instance-settings + /api/admin/captcha: the owner's instance
// settings on /admin/system (internal hosts, skill catalogue, the Turnstile login check). They
// were env vars in the deployment file; the owner's rule is that a deployment carries wiring, not
// settings.
//
// Ability comes from the outbound convergence point, the same admin Face the BYOAI write uses.

package admin

import (
	"github.com/go-chi/chi/v5"
)

// mountInstanceSettings mounts GET/PUT /instance-settings and PUT /captcha.
func (h *Handlers) mountInstanceSettings(r chi.Router) {
	face := h.BYOAI.Face
	r.Get("/instance-settings", h.dispatchOp(face, "instance.settings", emptyArgs, jsonOK))
	r.Put("/instance-settings", h.dispatchOp(face, "instance.settings_set", bodyArgs, jsonOK))
	// The Turnstile secret travels here only; the op is panel-only (it carries a raw secret).
	r.Put("/captcha", h.dispatchOp(face, "captcha.set", bodyArgs, jsonOK))
}
