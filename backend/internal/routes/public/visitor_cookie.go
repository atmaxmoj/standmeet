// visitor_cookie.go —— the visitor session's cookie: where a token is read from, and how the
// cookie is written, moved and cleared. Split out of chat.go (the 350-line cap).

package public

import (
	"net/http"
	"time"
)

// visitorSessionCookie —— the cookie name for the visitor session token.
const visitorSessionCookie = "sm_vsession"

// visitorToken —— fetches the visitor token: Authorization Bearer first, session cookie
// as fallback (works across tabs, survives refresh, recognized by SSR too).
func visitorToken(r *http.Request) (string, bool) {
	if t, ok := bearerToken(r); ok {
		return t, true
	}
	return cookieToken(r)
}

func cookieToken(r *http.Request) (string, bool) {
	c, err := r.Cookie(visitorSessionCookie)
	if err != nil || c.Value == "" {
		return "", false
	}
	return c.Value, true
}

// setVisitorSessionCookie —— writes the token into an HttpOnly cookie with the session's
// lifetime: at issue, and again each time the session slides (resolveVisitor). HttpOnly = JS can't
// read it (guards XSS theft); the browser sends it automatically with every request.
func setVisitorSessionCookie(
	w http.ResponseWriter, token string, expiresAt time.Time, secure bool,
) {
	http.SetCookie(w, &http.Cookie{
		Name: visitorSessionCookie, Value: token, Path: "/",
		HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode, Expires: expiresAt,
	})
}

// clearVisitorSessionCookie —— when a session is invalidated (401), writes back an
// expired cookie to clear it.
func clearVisitorSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: visitorSessionCookie, Value: "", Path: "/",
		HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: -1,
	})
}
