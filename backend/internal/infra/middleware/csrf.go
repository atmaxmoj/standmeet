// csrf.go — double-submit cookie CSRF defense.
//
// Flow:
//  1. On successful login, the server sets two cookies on the response:
//     - smt_session (HttpOnly, signed): the session credential
//     - csrftoken   (NOT HttpOnly):     the CSRF token, readable by JS
//  2. On mutating requests (POST/PUT/PATCH/DELETE), the admin frontend
//     sends `X-Csrftoken: <value read from the cookie>` in the header.
//  3. The server allows the request only if the CSRF value in the cookie
//     matches the one in the header.
//
// CSRFHeaderName is the canonical form ("X-Csrftoken"); HTTP headers
// themselves are case-insensitive, so an external client using
// "X-CSRFToken" still matches.

package middleware

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// CSRFCookieName is the CSRF cookie name (Django / Rails convention).
// CSRFHeaderName uses Go's canonical casing (http.Header.Get canonicalizes
// internally, so an external client using "X-CSRFToken" still matches,
// since HTTP headers are case-insensitive).
const (
	CSRFCookieName = "csrftoken"
	CSRFHeaderName = "X-Csrftoken"
)

// safeMethods are the methods that don't need CSRF validation (they don't
// change server state).
var safeMethods = map[string]bool{
	http.MethodGet:     true,
	http.MethodHead:    true,
	http.MethodOptions: true,
}

// RequireCSRF is the CSRF gate for mutating requests. A missing or
// mismatched cookie / header both return 403 csrf_invalid. Safe methods
// (GET/HEAD/OPTIONS) are allowed through.
func RequireCSRF(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if safeMethods[r.Method] {
			next.ServeHTTP(w, r)
			return
		}
		if !csrfValid(r) {
			writeCSRFInvalid(w)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func csrfValid(r *http.Request) bool {
	cookie, err := r.Cookie(CSRFCookieName)
	if err != nil {
		return false
	}
	header := r.Header.Get(CSRFHeaderName)
	if header == "" {
		return false
	}
	return cookie.Value == header
}

func writeCSRFInvalid(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusForbidden)
	payload := map[string]map[string]string{
		"error": {"code": "csrf_invalid", "message": "CSRF token missing or mismatched"},
	}
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		slog.Default().Error("write csrf envelope", "err", err)
	}
}
