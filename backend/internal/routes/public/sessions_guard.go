// sessions_guard.go —— #169 the wiring for access-code redemption lockout (split out
// of sessions.go to stay under max-lines). The createSession / codeIntro handlers
// both delegate here: lockout check + redemption + failure/success recording, keeping
// the handlers themselves within routes-cyclo ≤ 3.

package public

import (
	"context"
	"errors"
	"net/http"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

// guardedIssueSession —— code-tier lockout → redemption → recording. Returns (res,
// true) meaning a success response can be written; (_, false) meaning a response has
// already been written (429 lockout / error).
func (h *Handlers) guardedIssueSession(
	w http.ResponseWriter, r *http.Request, req *createSessionRequest,
) (conversation.IssueCodeSessionResult, bool) {
	ip := clientIP(r)
	if h.preIssueBlocked(w, r, req, ip) {
		return conversation.IssueCodeSessionResult{}, false
	}
	res, err := dispatchIssueSession(r.Context(), &h.Visitor, req, ip)
	if err != nil {
		h.noteCodeFail(r.Context(), ip, err)
		handleVisitorErr(h.Log, w, err)
		return conversation.IssueCodeSessionResult{}, false
	}
	h.CodeGuard.Reset(r.Context(), ip)
	return res, true
}

// guardedIntro —— same as above, for the name picker's pre-issue peek (also a
// code-enumeration oracle, same guard).
func (h *Handlers) guardedIntro(
	w http.ResponseWriter, r *http.Request, req *codeIntroRequest,
) (conversation.CodeIntroResult, bool) {
	ip := clientIP(r)
	if h.codeLocked(w, r, "code", req.CaptchaToken, ip) {
		return conversation.CodeIntroResult{}, false
	}
	res, err := conversation.CodeIntro(r.Context(), &h.Visitor, req.Code)
	if err != nil {
		h.noteCodeFail(r.Context(), ip, err)
		handleVisitorErr(h.Log, w, err)
		return conversation.CodeIntroResult{}, false
	}
	h.CodeGuard.Reset(r.Context(), ip)
	return res, true
}

// preIssueBlocked —— merges the two pre-issue checks into one (each already writes
// its own response when it blocks): ① code-redemption failure lockout (429) ② the
// embed origin allowlist (403). Merged into one so guardedIssueSession's cyclomatic
// complexity stays within 3 — order is priority: lockout first, then origin.
func (h *Handlers) preIssueBlocked(
	w http.ResponseWriter, r *http.Request, req *createSessionRequest, ip string,
) bool {
	if h.codeLocked(w, r, req.Mode, req.CaptchaToken, ip) {
		return true
	}
	return h.embedAuthBlocked(w, r, req)
}

// embedAuthBlocked —— carrying an embed_token verifies the widget's JWT (the
// plaintext code never reaches the client); otherwise it's a **direct plaintext code
// connection** — not subject to the origin restriction (the allowlist only gates the
// widget/token path). A direct plaintext connection behaves the same as no embed at
// all: a QR code / a shared link landing on the instance page, or pasting the code
// directly, both work — a leaked code just gets revoked
// ([[embed-direct-code-stays-open]]).
func (h *Handlers) embedAuthBlocked(
	w http.ResponseWriter, r *http.Request, req *createSessionRequest,
) bool {
	if req.EmbedToken != "" {
		return h.embedTokenBlocked(w, r, req)
	}
	return false
}

// embedTokenBlocked —— verifies the JWT. On success → fills the code it reveals into
// req (converting to code mode), and lets it through; on failure → writes 401/403 and
// blocks. The plaintext code is obtained by the server only at this step (req never
// carried it).
func (h *Handlers) embedTokenBlocked(
	w http.ResponseWriter, r *http.Request, req *createSessionRequest,
) bool {
	code, err := access.VerifyEmbedToken(
		r.Context(), h.embedTokenDeps(), req.EmbedToken, r.Header.Get("Origin"))
	if err != nil {
		handleVisitorErr(h.Log, w, err)
		return true
	}
	req.Code = code
	req.Mode = "code"
	return false
}

func (h *Handlers) embedTokenDeps() access.EmbedTokenDeps {
	return access.EmbedTokenDeps{Embeds: h.Embeds, Nonce: h.EmbedNonce, Log: h.Log}
}

// codeLocked —— code-tier and this IP is already locked → writes 429 and returns
// true; otherwise returns false and lets it through.
func (h *Handlers) codeLocked(
	w http.ResponseWriter, r *http.Request, mode, captchaToken, ip string,
) bool {
	if mode != "code" {
		return false
	}
	if !h.CodeGuard.Locked(r.Context(), ip, captchaToken) {
		return false
	}
	writeError(h.Log, w, h.codeLockedEnvelope())
	return true
}

// codeLockedEnvelope —— which message to say depends on whether this instance can
// currently offer that way through.
func (h *Handlers) codeLockedEnvelope() apierr.Envelope {
	if h.CodeGuard.HasLift() {
		return envCodeLockedCaptcha()
	}
	return envCodeLockedWait()
}

// noteCodeFail —— accumulates a failure only for an **invalid code** (a brute-force
// enumeration signal); expired/other errors don't count.
func (h *Handlers) noteCodeFail(ctx context.Context, ip string, err error) {
	if errors.Is(err, access.ErrCodeInvalid) {
		h.CodeGuard.RecordFail(ctx, ip)
	}
}
