// recovery.go —— #100 account recovery phrase 的两个 HTTP 端点。
//   POST /api/admin/account/recovery  (authed) 生成 phrase + 邮给 owner
//   POST /api/admin/recover           (public, login-guard'd) {email, phrase} → session

package admin

import (
	"encoding/json"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
	"github.com/atmaxmoj/standmeet/internal/owner"
)

type recoverRequest struct {
	Email          string `json:"email"`
	RecoveryPhrase string `json:"recovery_phrase"`
}

type recoverResponse struct {
	OwnerID     string `json:"owner_id"`
	OwnerHandle string `json:"owner_handle"`
	CSRFToken   string `json:"csrf_token"`
}

var recoverErrCases = []apierr.Case{
	{Match: apierr.ErrEmptyField, Envelope: apierr.Envelope{
		Status:  http.StatusBadRequest,
		Code:    "bad_request",
		Message: "email and recovery phrase required",
	}},
	{Match: owner.ErrUnauthorized, Envelope: apierr.Envelope{
		Status:  http.StatusUnauthorized,
		Code:    "recovery_invalid",
		Message: "email or recovery phrase incorrect",
	}},
}

// generateRecovery —— authed:生成 recovery phrase(只存 hash)+ 明文邮给 owner。没配 mail
// connector → Send 失败 → 502(引导去配)。
func (h *Handlers) generateRecovery() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		if err := owner.GenerateRecovery(r.Context(), &h.Recovery, ownerID); err != nil {
			h.Log.Warn("generate recovery", "err", err)
			writeError(h.Log, w, apierr.Envelope{
				Status:  http.StatusBadGateway,
				Code:    "recovery_send_failed",
				Message: "couldn't email the recovery phrase — verify your mail connector first",
			})
			return
		}
		writeJSON(h.Log, w, map[string]bool{"sent": true})
	}
}

// recover —— public(login-guard'd):{email, phrase} 对上 → 发 owner session(登进去改密码)。
func (h *Handlers) recover() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body recoverRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		out, err := owner.Recover(r.Context(), &h.Recovery, &owner.RecoverInput{
			Email: body.Email, Phrase: body.RecoveryPhrase,
		})
		if err != nil {
			writeError(h.Log, w, apierr.Classify(err, recoverErrCases))
			return
		}
		setSessionCookies(w, out.SessionToken, out.CSRFToken, h.SecureCookie)
		writeJSON(h.Log, w, recoverResponse{
			OwnerID: out.OwnerID, OwnerHandle: out.OwnerHandle, CSRFToken: out.CSRFToken,
		})
	}
}
