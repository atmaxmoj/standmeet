// password_reset.go —— POST /api/v1/account/reset-password
//
// 兜底紧急 password reset：operator 在 server 上跑 standmeet password-reset
// 子命令颁发 token；owner 拿 token 来这里 consume 改密码。
//
// 不需要 session，公开端点；token 本身就是凭据。
// rate-limit 通过 chi 默认 timeout 兜，不在这里加（reset 流程节奏低；服务器
// shell 已经是高门槛了，brute force 不实际）。

package public

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/wangsijie/standmeet/internal/apierr"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/usecases"
)

// PasswordResetHandlers —— /api/v1/account/reset-password 路由依赖。
type PasswordResetHandlers struct {
	Deps usecases.PasswordResetDeps
	Log  *slog.Logger
}

// Mount 挂 /account/reset-password。caller 前缀 /api/v1。
func (h *PasswordResetHandlers) Mount(r chi.Router) {
	r.Post("/account/reset-password", h.resetPassword())
}

type resetPasswordBody struct {
	Token       string `json:"token"`
	NewPassword string `json:"new_password"`
}

func (h *PasswordResetHandlers) resetPassword() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body resetPasswordBody
		if derr := json.NewDecoder(r.Body).Decode(&body); derr != nil {
			writeError(h.Log, w, apierr.Envelope{
				Status: http.StatusBadRequest, Code: "bad_request", Message: "invalid JSON body",
			})
			return
		}
		err := usecases.ConsumePasswordResetToken(r.Context(), h.Deps, body.Token, body.NewPassword)
		if err != nil {
			handlePasswordResetErr(h.Log, w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handlePasswordResetErr(log *slog.Logger, w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, usecases.ErrPasswordTooShort):
		writeError(log, w, apierr.Envelope{
			Status: http.StatusBadRequest, Code: "password_too_short",
			Message: "password must be at least 12 characters",
		})
	case errors.Is(err, domain.ErrUnauthorized), errors.Is(err, domain.ErrOwnerNotFound):
		writeError(log, w, apierr.Envelope{
			Status: http.StatusUnauthorized, Code: "unauthorized",
			Message: "invalid or expired reset token",
		})
	default:
		log.Error("password reset", "err", err)
		writeError(log, w, apierr.Envelope{
			Status: http.StatusInternalServerError, Code: "server_error", Message: "internal error",
		})
	}
}
