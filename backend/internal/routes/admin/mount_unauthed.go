// mount_unauthed.go — the handful of admin routes that don't need an owner session, and
// which guard layer wraps each one.
//
// Kept in its own file because the judgment here isn't tied to any one handler: it
// decides **which route lands in which rate-limit bucket**, and that bucket is shared —
// picking wrong lets one route burn another route's quota (see the confirm-email section
// below). A judgment like that buried in the middle of some handler file never gets
// re-checked by anyone.

package admin

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// MountUnauthed mounts the endpoints that don't need an owner session.
// loginGuard is the brute-force defense (per-IP rate-limit + equal-time response).
func (h *Handlers) MountUnauthed(
	r chi.Router, loginGuard func(http.Handler) http.Handler,
) {
	// claim uses a one-time setup token, so brute force isn't practical here — not wrapped.
	r.Post("/claim", h.claim())
	r.Group(func(r chi.Router) {
		r.Use(loginGuard)
		r.Post("/login", h.login())
		// #100: public account recovery — a matching {email, phrase} issues a session.
		// Rate-limited by the same guard as login (the brute-force surface is the same).
		r.Post("/recover", h.recover())
	})
	// Confirm email change — **public**: the owner may open this email on another
	// device, not logged in. Requiring login first to confirm would mean requiring them
	// to log in with the identity they're in the middle of changing away from.
	//
	// **Outside the Group**: loginGuard's bucket is `<prefix>+ip`, one per IP, shared by
	// /login and /recover. Placed inside the Group, clicking the confirmation link a few
	// times would burn through the login quota — and if this instance's upstream proxy
	// doesn't set X-Forwarded-For (the backend warns about this at startup), every
	// visitor counts as the same IP, so "confirm email" could lock the owner out of
	// login entirely.
	//
	// It needs no rate limit of its own: the token is 128-bit random + matched only by
	// hash + single-use + 24h expiry, and this route can't create any new change — it
	// only redeems a change the owner already initiated while logged in.
	//
	// Warning: these lines used to be here, but **the code sat inside the Group** — the
	// comment said "not wrapped" while the panic stack trace clearly went through
	// loginGuard. Fix the code, not this paragraph.
	r.Post("/confirm-email", h.confirmEmail())
}
