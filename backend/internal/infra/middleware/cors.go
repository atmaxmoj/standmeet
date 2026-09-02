package middleware

import "net/http"

// PublicCORS is the wide-open CORS policy for the public visitor surface
// (/api/v1/*).
//
// D.2: @standmeet/embed / @standmeet/sdk load from any third-party site's
// origin, so the browser sends a preflight for cross-origin session/chat/SSE
// requests. Without CORS headers the browser blocks the response from JS
// outright, and embed can't bootstrap at all (verified for real: F-O-1,
// OPTIONS → 405, zero ACAO).
//
// The SDK authenticates with the Bearer token returned by /sessions (not
// cookies — see core client.ts), so Allow-Origin: * is safe — it doesn't
// need credentials mode, so there's no need to narrow the origin either.
//
// Mounted at the **outermost** layer of the /api/v1 group (before
// BanGuard/RateGuard): even when a later step returns 403/429, the browser
// still needs to read ACAO first before it can hand the real status code to
// embed — otherwise a cross-origin failure blurs into one opaque CORS
// error. OPTIONS preflight short-circuits to 204 here (otherwise chi
// returns 405 for a route that only defines POST).
func PublicCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Access-Control-Allow-Origin", "*")
		h.Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		h.Set("Access-Control-Max-Age", "600")
		h.Add("Vary", "Origin")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
