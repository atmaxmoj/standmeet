// Package middleware 提供 chi 中间件，包括 owner auth + CSRF。
// 中间件不做业务，只把 ctx-bound 信息（current owner、CSRF token）注入。
package middleware

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/wangsijie/standmeet/internal/session"
)

// 内部 ctx key 类型，避免和别的包冲突。
type ctxKey struct{ name string }

var (
	ctxKeyOwnerID = ctxKey{name: "ownerID"}
	ctxKeySession = ctxKey{name: "ownerSession"}
)

// SessionCookieName 是 owner session 的 cookie 名（设计稿 E 已定）。
const SessionCookieName = "smt_session"

// WithOwner 是 admin 路由的鉴权 gate：从 cookie 拿 session token、Redis
// lookup、把 owner_id + 完整 SessionData 注入 ctx。无 session 或失效
// 返回 401 envelope。
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

// lookupSession 辅助 WithOwner 保持 cyclo ≤ 3。
func lookupSession(
	r *http.Request, store *session.OwnerSessionStore,
) (session.OwnerSessionData, bool) {
	cookie, err := r.Cookie(SessionCookieName)
	if err != nil {
		return session.OwnerSessionData{}, false
	}
	data, err := store.Get(r.Context(), cookie.Value)
	if err != nil {
		// Redis 故障也当 401 —— 不让 owner 在 Redis 挂时也能 access。
		if !errors.Is(err, session.ErrSessionNotFound) {
			slog.Default().Warn("session lookup error (treating as 401)", "err", err)
		}
		return session.OwnerSessionData{}, false
	}
	return data, true
}

// OwnerIDFrom 从 ctx 取 owner_id；用在 handler 里调 Repository / usecase。
// 没值（中间件没跑）返回空字符串，caller 当 server bug 处理。
func OwnerIDFrom(ctx context.Context) string {
	v, ok := ctx.Value(ctxKeyOwnerID).(string)
	if !ok {
		return ""
	}
	return v
}

// SessionFrom 从 ctx 取整个 SessionData（含 csrf_token / expires_at）。
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
