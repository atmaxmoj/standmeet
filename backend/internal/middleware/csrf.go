// csrf.go —— double-submit cookie CSRF 防御。
//
// 流程：
//  1. login 成功后，server 在 response 同时设两个 cookie：
//     - smt_session (HttpOnly, signed): session 凭证
//     - csrftoken   (NOT HttpOnly):     CSRF token，JS 可读
//  2. admin 前端在 mutating 请求（POST/PUT/PATCH/DELETE）的 header 里
//     带 `X-Csrftoken: <从 cookie 读到的值>`。
//  3. server 比对 cookie 里的 csrf 和 header 里的 csrf 一致才放行。
//
// CSRFHeaderName 是 canonical form ("X-Csrftoken")；HTTP header 本身
// case-insensitive，外部客户端用 "X-CSRFToken" 也能匹配。

package middleware

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// CSRFCookieName 是 CSRF cookie 名（Django / Rails convention）。
// CSRFHeaderName 用 Go canonical 大小写（http.Header.Get 内部会 canonicalize，
// 外部 client 用 "X-CSRFToken" 也能匹配，因为 HTTP header case-insensitive）。
const (
	CSRFCookieName = "csrftoken"
	CSRFHeaderName = "X-Csrftoken"
)

// safeMethods 是不需要 CSRF 校验的方法（不改 server 状态）。
var safeMethods = map[string]bool{
	http.MethodGet:     true,
	http.MethodHead:    true,
	http.MethodOptions: true,
}

// RequireCSRF 是 mutating 请求的 CSRF gate。Cookie 和 header 缺失 / 不一致
// 都返回 403 csrf_invalid。Safe method（GET/HEAD/OPTIONS）放行。
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
