// connectors_authorize.go — the return leg of the oauth2 dance (the callback). The dance
// itself starts with the frontend's window.location jumping to the provider (the auth_url
// returned by POST /connect); once the provider consents, it comes back here with
// code+state to exchange for a token. The dance is a browser navigation, so an error
// can't return a JSON error page (it would dump the raw response on the owner) — it
// always 302s back to the connectors area (a constant target, to avoid feeding the
// provider's auth_url or path parameters into the Location header); a failure carries
// connect_error=1, and the frontend uses the "which one I'm connecting" it kept in
// sessionStorage to land a friendly error on the right card.

package admin

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// connectorOAuthCallback — the provider returns with code+state → exchange for a token.
// A provider rejection (?error=) / a state mismatch / a token exchange failure all →
// 302 back to the connectors area with connect_error=1.
func (h *Handlers) connectorOAuthCallback() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("error") != "" {
			http.Redirect(w, r, "/admin/connectors?connect_error=1", http.StatusFound)
			return
		}
		err := h.ConnectorsAdmin.Svc.Callback(
			r.Context(), chi.URLParam(r, paramID),
			r.URL.Query().Get("code"), r.URL.Query().Get("state"),
		)
		if err != nil {
			// The return leg always 302s (never dumps the response on the owner), but
			// a failure still has to leave a trace — otherwise a Redis/token-side
			// infra fault would be as silent as "the user replayed an expired state",
			// and ops would have nothing to go on.
			h.Log.Warn("connector oauth callback", logErrKey, err)
			http.Redirect(w, r, "/admin/connectors?connect_error=1", http.StatusFound)
			return
		}
		http.Redirect(w, r, "/admin/connectors", http.StatusFound)
	}
}
