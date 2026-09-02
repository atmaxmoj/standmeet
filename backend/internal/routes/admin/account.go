// account.go — /api/admin/account/* + GET /me: the owner's own account.
//
// Capability comes from the outbound convergence point (shared plumbing in dispatch.go).
// Changing email / changing password / generating a recovery phrase all carry credentials —
// a deliberate single-facade decision: admin only, MCP never carries raw credentials.
//
// GET /me returns {owner, settings} — before the migration, MCP's `me` was a hand-built
// four-field JSON string with no escaping (a single quote in the name produced invalid JSON);
// now both facades share the same shape and the same serializer.

package admin

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// AccountDeps — capability source for the admin account handlers.
type AccountDeps struct {
	Face *dispatcher.Face
}

// MountAccount mounts /account/* (caller prefix /api/admin).
//
// email / password **both** wrap credGuard: they lead to the same thing (changing
// credentials), so wrapping only one is the same as wrapping none — a different entry
// point walks right around it ([[gate-after-early-return-is-walkable]]).
// full-name / timezone don't wrap it: they don't verify the current password, so there's
// no brute-force surface.
func (h *Handlers) MountAccount(r chi.Router, credGuard func(http.Handler) http.Handler) {
	face := h.AccountAdmin.Face
	r.Route("/account", func(r chi.Router) {
		r.Patch("/full-name",
			h.dispatchOp(face, "account.set_full_name", bodyArgs, jsonOK))
		r.Patch("/timezone", h.dispatchOp(face, "account.set_timezone", bodyArgs, jsonOK))
		r.Group(func(r chi.Router) {
			r.Use(credGuard)
			r.Patch("/email", h.dispatchOp(face, "account.change_email", bodyArgs, jsonOK))
			r.Patch("/password",
				h.dispatchOp(face, "account.change_password", bodyArgs, noContent))
		})
		// Cancels a pending email change. Doesn't wrap credGuard: it doesn't verify the
		// password, so there's no brute-force surface.
		r.Post("/email/cancel",
			h.dispatchOp(face, "account.cancel_email_change", emptyArgs, jsonOK))
		// #100: generates a recovery phrase (only the hash is stored; the plaintext is
		// emailed to the owner).
		r.Post("/recovery",
			h.dispatchOp(face, "account.generate_recovery", emptyArgs, jsonOK))
	})
}

// MountMe mounts GET /me (caller prefix /api/admin).
func (h *Handlers) MountMe(r chi.Router) {
	r.Get("/me", h.dispatchOp(h.AccountAdmin.Face, "me", emptyArgs, jsonOK))
}
