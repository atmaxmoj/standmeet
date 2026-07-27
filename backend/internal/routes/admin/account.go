// account.go —— /api/admin/account/* —— owner 自助管理账号字段。
//
//   PATCH /api/admin/account/full-name  { full_name }
//   PATCH /api/admin/account/email      { current_password, new_email }
//   PATCH /api/admin/account/password   { current_password, new_password }
//
// email + password 改之前必须验当前密码——usecase 拒绝时统一返
// owner.ErrUnauthorized，handler 翻 401 跟 login 同码。

package admin

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// AccountDeps —— admin account endpoints 的依赖。
type AccountDeps struct {
	Account owner.AccountDeps
}

// MountAccount 挂 /account/* （caller 前缀 /api/admin）。
func (h *Handlers) MountAccount(r chi.Router) {
	r.Route("/account", func(r chi.Router) {
		r.Patch("/full-name", h.updateFullName())
		r.Patch("/email", h.updateEmail())
		r.Patch("/password", h.updatePassword())
		// #100: 生成 recovery phrase(只存 hash,明文邮给 owner)。
		r.Post("/recovery", h.generateRecovery())
	})
}

// ─── full-name ──────────────────────────────────────────────

type updateFullNameBody struct {
	FullName string `json:"full_name"`
}

type ownerFieldResp struct {
	FullName string `json:"full_name,omitempty"`
	Email    string `json:"email,omitempty"`
}

func (h *Handlers) updateFullName() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body updateFullNameBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		ownerID := middleware.OwnerIDFrom(r.Context())
		updated, err := owner.UpdateOwnerFullName(
			r.Context(), h.AccountAdmin.Account, ownerID, body.FullName,
		)
		if err != nil {
			handleAccountErr(h.Log, w, err)
			return
		}
		writeOwnerField(h.Log, w, ownerFieldResp{FullName: updated.FullName})
	}
}

// ─── email ──────────────────────────────────────────────────

type updateEmailBody struct {
	CurrentPassword string `json:"current_password"`
	NewEmail        string `json:"new_email"`
}

func (h *Handlers) updateEmail() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body updateEmailBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		ownerID := middleware.OwnerIDFrom(r.Context())
		updated, err := owner.UpdateOwnerEmail(r.Context(), h.AccountAdmin.Account,
			&owner.EmailUpdateInput{
				OwnerID: ownerID, CurrentPassword: body.CurrentPassword, NewEmail: body.NewEmail,
			})
		if err != nil {
			handleAccountErr(h.Log, w, err)
			return
		}
		writeOwnerField(h.Log, w, ownerFieldResp{Email: updated.Email})
	}
}

// ─── password ───────────────────────────────────────────────

type updatePasswordBody struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

func (h *Handlers) updatePassword() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body updatePasswordBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		ownerID := middleware.OwnerIDFrom(r.Context())
		err := owner.UpdateOwnerPassword(r.Context(), h.AccountAdmin.Account,
			&owner.PasswordUpdateInput{
				OwnerID:         ownerID,
				CurrentPassword: body.CurrentPassword,
				NewPassword:     body.NewPassword,
			})
		if err != nil {
			handleAccountErr(h.Log, w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// ─── shared helpers ─────────────────────────────────────────

func writeOwnerField(log *slog.Logger, w http.ResponseWriter, resp ownerFieldResp) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Error("encode owner field", "err", err)
	}
}

func handleAccountErr(log *slog.Logger, w http.ResponseWriter, err error) {
	if env, ok := accountSentinelToEnv(err); ok {
		writeError(log, w, env)
		return
	}
	log.Error("account update", "err", err)
	writeError(log, w, serverErr())
}

// accountErrCases —— table-driven sentinel → envelope，让 cyclo ≤ 3
// （apierr.Classify 走 errors.Is unwrap chain）。
var accountErrCases = []apierr.Case{
	{
		Match: owner.ErrUnauthorized,
		Envelope: apierr.Envelope{
			Status: http.StatusUnauthorized, Code: "unauthorized",
			Message: "invalid credentials",
		},
	},
	{
		Match: owner.ErrEmailTaken,
		Envelope: apierr.Envelope{
			Status: http.StatusConflict, Code: "email_taken",
			Message: "email already in use",
		},
	},
	{
		Match:    owner.ErrPasswordTooShort,
		Envelope: envBadReq("password must be at least 12 characters"),
	},
	{
		Match:    apierr.ErrEmptyField,
		Envelope: envBadReq("required field is empty"),
	},
}

func accountSentinelToEnv(err error) (apierr.Envelope, bool) {
	env := apierr.Classify(err, accountErrCases)
	if env.Status >= http.StatusInternalServerError {
		return apierr.Envelope{}, false
	}
	return env, true
}
