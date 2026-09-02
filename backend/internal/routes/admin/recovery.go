// recovery.go — the two HTTP endpoints for #100 account recovery phrase.
//   POST /api/admin/account/recovery  (authed) generates a phrase + emails it to the owner
//   POST /api/admin/recover           (public, login-guard'd) {email, phrase} → session

package admin

import (
	"encoding/json"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
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

// generateRecovery — authed: generates a recovery phrase (only the hash is stored) +
// emails the plaintext to the owner. No mail connector configured → Send fails → 502
// (guides them to configure one).

// recover — public (login-guard'd): a matching {email, phrase} → issues an owner session
// (logging them in to change their password).
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

// -- Confirm email change --
//
//	POST /api/admin/confirm-email  (public) {token} → swap identity
//
// **Kept in the same file as /recover** because they're two instances of the same thing:
// no session, identity proven by "you're holding the secret we mailed you". It isn't
// placed here to route around the gate either — `check-routes-via-dispatcher`'s baseline
// can **only shrink**, and the convergence point has no public facade yet (`PlaneOwner`
// is the only Reach constructor; the whole of routes/public/ is still in the baseline).
// Once the public facade exists, these two move together.
//
// **Why it's public**: the owner may open this email on another device, not logged in.
// Requiring login first to confirm would mean requiring them to log in with **the
// identity they haven't switched away from yet** — and changing email is often exactly
// because the old address is about to stop working.
//
// Public doesn't mean unprotected: the token is 128-bit random, matched only by hash,
// single-use, expires in 24 hours, and this route **can't create** a new change — it only
// redeems a change the owner already initiated while logged in.

type confirmEmailRequest struct {
	Token string `json:"token"`
}

type confirmEmailResponse struct {
	Email string `json:"email"`
}

// confirmEmailErrCases — expired and invalid split into two codes, because what the
// owner should do next differs: expired → go back to the panel and click save again
// (that path still exists); invalid → this email isn't for you / it's already been used.
// "already used" and "the token was made up" are **deliberately** merged into the latter:
// to someone who doesn't already know this token, distinguishing them would only tell
// them whether their guess was close.
var confirmEmailErrCases = []apierr.Case{
	{Match: owner.ErrPendingEmailExpired, Envelope: apierr.Envelope{
		Status: http.StatusGone,
		Code:   "email_confirm_expired",
		Message: "that confirmation link has expired — start the change again " +
			"from your account page",
	}},
	{Match: owner.ErrPendingEmailNotFound, Envelope: apierr.Envelope{
		Status:  http.StatusNotFound,
		Code:    "email_confirm_invalid",
		Message: "that confirmation link is not valid — it may already have been used",
	}},
}

func (h *Handlers) confirmEmail() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body confirmEmailRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		// The empty-token check lives in the domain (ConfirmEmailChange) — that's "what
		// counts as a valid confirmation", business logic, not something to restate here.
		// This facade only does decoding and translation, nothing else.
		updated, err := owner.ConfirmEmailChange(r.Context(), h.EmailChange, body.Token)
		if err != nil {
			writeError(h.Log, w, apierr.Classify(err, confirmEmailErrCases))
			return
		}
		writeJSON(h.Log, w, confirmEmailResponse{Email: updated.Email})
	}
}
