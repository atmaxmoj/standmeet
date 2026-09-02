// Package middleware provides chi middleware, including owner auth + CSRF.
// Middleware carries no business logic — it only injects ctx-bound info
// (current owner, CSRF token).
package middleware

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/infra/session"
)

// Internal ctx key type, to avoid colliding with other packages.
type ctxKey struct{ name string }

var (
	ctxKeyOwnerID = ctxKey{name: "ownerID"}
	ctxKeySession = ctxKey{name: "ownerSession"}
)

// SessionCookieName is the owner session cookie name (fixed by design doc E).
const SessionCookieName = "smt_session"

// WithOwner is the auth gate for admin routes: it takes the session token
// from the cookie, looks it up in Redis, and injects owner_id + the full
// SessionData into ctx. No session, or an expired one, returns a 401
// envelope.
func WithOwner(store *session.OwnerSessionStore) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			data, ok := lookupSession(r, store)
			if !ok {
				writeUnauthorized(w)
				return
			}
			ctx := r.Context()
			ctx = context.WithValue(ctx, ctxKeyOwnerID, data.OwnerID)
			ctx = context.WithValue(ctx, ctxKeySession, data)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// lookupSession helps WithOwner stay at cyclo ≤ 3.
func lookupSession(
	r *http.Request, store *session.OwnerSessionStore,
) (session.OwnerSessionData, bool) {
	cookie, err := r.Cookie(SessionCookieName)
	if err != nil {
		return session.OwnerSessionData{}, false
	}
	data, err := store.Get(r.Context(), cookie.Value)
	if err != nil {
		// Treat a Redis failure as 401 too — don't let the owner keep access
		// while Redis is down.
		if !errors.Is(err, session.ErrSessionNotFound) {
			slog.Default().Warn("session lookup error (treating as 401)", "err", err)
		}
		return session.OwnerSessionData{}, false
	}
	return data, true
}

// OwnerIDFrom reads owner_id from ctx; used inside handlers when calling a
// Repository / usecase. No value (middleware didn't run) returns an empty
// string, and the caller should treat that as a server bug.
func OwnerIDFrom(ctx context.Context) string {
	v, ok := ctx.Value(ctxKeyOwnerID).(string)
	if !ok {
		return ""
	}
	return v
}

// SessionFrom reads the whole SessionData from ctx (includes csrf_token /
// expires_at).
func SessionFrom(ctx context.Context) (session.OwnerSessionData, bool) {
	v, ok := ctx.Value(ctxKeySession).(session.OwnerSessionData)
	return v, ok
}

func writeUnauthorized(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	payload := map[string]map[string]string{
		"error": {"code": "unauthorized", "message": "authentication required"},
	}
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		slog.Default().Error("write unauthorized envelope", "err", err)
	}
}
