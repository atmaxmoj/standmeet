// password_reset.go —— POST /api/v1/account/reset-password
//
// Fallback emergency password reset: an operator runs the standmeet password-reset
// subcommand on the server to issue a token; the owner brings that token here to
// consume it and change the password.
//
// No session required, a public endpoint; the token itself is the credential.
// Rate-limiting is covered by chi's default timeout, no extra limiter added here (the
// reset flow is low-cadence; server shell access is already a high bar, so brute force
// isn't practical).

package public

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// PasswordResetHandlers —— dependencies for the /api/v1/account/reset-password route.
type PasswordResetHandlers struct {
	Deps owner.PasswordResetDeps
	Log  *slog.Logger
}

// Mount wires /account/reset-password. Caller prefixes /api/v1.
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
		err := owner.ConsumePasswordResetToken(r.Context(), h.Deps, body.Token, body.NewPassword)
		if err != nil {
			handlePasswordResetErr(h.Log, w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handlePasswordResetErr(log *slog.Logger, w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, owner.ErrPasswordTooShort):
		writeError(log, w, apierr.Envelope{
			Status: http.StatusBadRequest, Code: "password_too_short",
			Message: "password must be at least 12 characters",
		})
	case errors.Is(err, owner.ErrUnauthorized), errors.Is(err, owner.ErrOwnerNotFound):
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
