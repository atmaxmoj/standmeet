// auth.go —— admin login / logout / csrf endpoints。
// 都是 thin handler：解 body / 调 usecase / 写 cookie。

package admin

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/wangsijie/standmeet/internal/apierr"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/middleware"
	"github.com/wangsijie/standmeet/internal/session"
	"github.com/wangsijie/standmeet/internal/usecases"
)

const ownerSessionMaxAge = 24 * 60 * 60 // 秒；和 OwnerSessionStore 的 TTL 对齐。

// AuthDeps —— login / logout / me 需要的依赖（admin Deps 内嵌一个）。
type AuthDeps struct {
	Login    usecases.LoginDeps
	Sessions *session.OwnerSessionStore
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type loginResponse struct {
	OwnerID   string `json:"owner_id"`
	CSRFToken string `json:"csrf_token"`
}

var loginErrCases = []apierr.Case{
	{
		Match:    usecases.ErrEmptyField,
		Envelope: envBadReq("missing email or password"),
	},
	{
		Match: domain.ErrUnauthorized,
		Envelope: apierr.Envelope{
			Status: http.StatusUnauthorized, Code: "unauthorized", Message: "invalid credentials",
		},
	},
}

// login: POST /api/admin/login —— 验密码 + 写 session cookie + csrf cookie。
func login(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req loginRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(deps.Log, w, envBadReq("invalid JSON body"))
			return
		}
		out, err := usecases.Login(r.Context(), deps.Auth.Login, &usecases.LoginInput{
			Email: req.Email, Password: req.Password,
		})
		if err != nil {
			handleLoginErr(deps.Log, w, err)
			return
		}
		setSessionCookies(w, out.SessionToken, out.CSRFToken)
		writeLoginResp(deps.Log, w, &out)
	}
}

func handleLoginErr(log *slog.Logger, w http.ResponseWriter, err error) {
	env := apierr.Classify(err, loginErrCases)
	if env.Status >= http.StatusInternalServerError {
		log.Error("login failed", "err", err)
	}
	writeError(log, w, env)
}

func writeLoginResp(log *slog.Logger, w http.ResponseWriter, out *usecases.LoginOutput) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	resp := loginResponse{OwnerID: out.OwnerID, CSRFToken: out.CSRFToken}
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Error("encode login response", "err", err)
	}
}

func setSessionCookies(w http.ResponseWriter, sessionToken, csrfToken string) {
	http.SetCookie(w, &http.Cookie{
		Name:     middleware.SessionCookieName,
		Value:    sessionToken,
		Path:     "/api/admin",
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   ownerSessionMaxAge,
	})
	// CSRF cookie 必须 HttpOnly=false，让 admin 前端 JS 读了塞 header。
	// double-submit 模式的安全前提：cookie 不是 HttpOnly，但 Secure +
	// SameSite=Lax 防止跨站读到。
	//nolint:gosec // G124 误报：double-submit CSRF 模式必须 HttpOnly=false
	http.SetCookie(w, &http.Cookie{
		Name:     middleware.CSRFCookieName,
		Value:    csrfToken,
		Path:     "/api/admin",
		HttpOnly: false,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   ownerSessionMaxAge,
	})
}

func clearSessionCookies(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     middleware.SessionCookieName,
		Value:    "",
		Path:     "/api/admin",
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
	})
	// 清空 CSRF cookie 同样需要 HttpOnly=false（同 setSessionCookies 的理由）。
	//nolint:gosec // G124 误报：double-submit CSRF 模式必须 HttpOnly=false
	http.SetCookie(w, &http.Cookie{
		Name:     middleware.CSRFCookieName,
		Value:    "",
		Path:     "/api/admin",
		HttpOnly: false,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
	})
}

// logout: POST /api/admin/me/logout —— 删 Redis session + 清 cookie。
func logout(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(middleware.SessionCookieName)
		if err == nil {
			if rerr := deps.Auth.Sessions.Revoke(r.Context(), cookie.Value); rerr != nil {
				deps.Log.Warn("revoke session (non-fatal)", "err", rerr)
			}
		}
		clearSessionCookies(w)
		w.WriteHeader(http.StatusNoContent)
	}
}

// csrfEndpoint: GET /api/admin/csrf —— admin 前端 bootstrap 时调，拿 token 注 header。
// 没 session 也能调；返回的 csrf cookie 在登录前是临时的，登录后会被覆盖。
func csrfEndpoint(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		data, ok := middleware.SessionFrom(r.Context())
		if !ok {
			writeError(deps.Log, w, apierr.Envelope{
				Status: http.StatusUnauthorized, Code: "unauthorized", Message: "no session",
			})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		payload := map[string]string{"csrf_token": data.CSRFToken}
		if err := json.NewEncoder(w).Encode(payload); err != nil {
			deps.Log.Error("encode csrf response", "err", err)
		}
	}
}
