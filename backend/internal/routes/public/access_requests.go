// access_requests.go —— POST /api/v1/access-requests —— a visitor message with no access code.
// No auth required; body validation failure returns 400, missing handle returns 404.

package public

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// RequestGuard —— the per-IP gate on the message endpoint (implemented in infra/middleware).
// A narrow interface: this layer only asks "block or not" and "record one" — captcha and
// redis both stay hidden behind the boundary, same rule as CodeGuard.
type RequestGuard interface {
	Locked(ctx context.Context, ip, captchaToken string) bool
	// HasLift —— whether someone who just got blocked has a way through right now (only
	// true when captcha is enabled). The rejection message picks its wording off this,
	// otherwise it would describe a control that isn't on the screen.
	HasLift() bool
	RecordSubmit(ctx context.Context, ip string)
}

// AccessRequestsHandlers —— dependencies for the public access-request route.
type AccessRequestsHandlers struct {
	Reqs  access.RequestsDeps
	Guard RequestGuard
	Log   *slog.Logger
}

// Mount wires POST /access-requests. Caller owns the prefix.
func (h *AccessRequestsHandlers) Mount(r chi.Router) {
	r.Post("/access-requests", h.submit())
}

type submitRequestBody struct {
	Name    string `json:"name"`
	Org     string `json:"org"`
	Email   string `json:"email"`
	Message string `json:"message"`
	// CaptchaToken —— the ticket that grants passage once the threshold is exceeded.
	// Same shape as code redemption (F-G-4).
	CaptchaToken string `json:"captcha_token,omitempty"`
}

type submitRequestResponse struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

func (h *AccessRequestsHandlers) submit() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req submitRequestBody
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		h.guardedSubmit(w, r, &req)
	}
}

// guardedSubmit —— gate → write → record. This endpoint has no auth, and what it writes
// into is a queue the owner reads one item at a time, so volume itself is the signal (F-G-4).
func (h *AccessRequestsHandlers) guardedSubmit(
	w http.ResponseWriter, r *http.Request, req *submitRequestBody,
) {
	ip := clientIP(r)
	if h.Guard.Locked(r.Context(), ip, req.CaptchaToken) {
		writeError(h.Log, w, h.floodEnvelope())
		return
	}
	out, err := access.SubmitForOwner(
		r.Context(), h.Reqs, &access.SubmitAccessRequestInput{
			Name: req.Name, Org: req.Org,
			Email: req.Email, Message: req.Message,
		},
	)
	if err != nil {
		handleAccessRequestErr(h.Log, w, err)
		return
	}
	// **Counted on success too**: what's tallied here is volume, not errors. A message
	// carries no right or wrong — too many of them is the signal.
	h.Guard.RecordSubmit(r.Context(), ip)
	writeSubmitResp(h.Log, w, &out)
}

// floodEnvelope —— which message to say depends on whether this instance can currently
// offer that way through (same rule as code redemption).
func (h *AccessRequestsHandlers) floodEnvelope() apierr.Envelope {
	if h.Guard.HasLift() {
		return envRequestFloodCaptcha()
	}
	return envRequestFloodWait()
}

// envRequestFloodWait / envRequestFloodCaptcha —— the two variants of "too many submissions
// from here". Saying only "try again later" would make someone with a real message to send
// think they're permanently locked out; and on a deployment with captcha disabled there is
// no check to clear, so telling them to "pass a human check" would point at a control that
// doesn't exist.
func envRequestFloodWait() apierr.Envelope {
	return requestFlood("too many notes from here — try again in a few minutes")
}

func envRequestFloodCaptcha() apierr.Envelope {
	return requestFlood(
		"too many notes from here — clear the human check and this one goes through",
	)
}

func requestFlood(msg string) apierr.Envelope {
	return apierr.Envelope{
		Status: http.StatusTooManyRequests, Code: "request_flood", Message: msg,
	}
}

func writeSubmitResp(log *slog.Logger, w http.ResponseWriter, a *access.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	resp := submitRequestResponse{ID: a.ID, Status: a.Status}
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Error("encode access request resp", "err", err)
	}
}

func handleAccessRequestErr(log *slog.Logger, w http.ResponseWriter, err error) {
	env := classifyAccessRequestErr(err)
	if env.Status >= http.StatusInternalServerError {
		log.Error("access request submit", "err", err)
	}
	writeError(log, w, env)
}

func classifyAccessRequestErr(err error) apierr.Envelope {
	if errors.Is(err, apierr.ErrEmptyField) {
		return apierr.Envelope{
			Status: http.StatusBadRequest, Code: "bad_request", Message: "missing required field",
		}
	}
	if errors.Is(err, owner.ErrOwnerNotFound) {
		return apierr.Envelope{
			Status:  http.StatusNotFound,
			Code:    "owner_not_found",
			Message: "instance not yet claimed",
		}
	}
	return apierr.Envelope{
		Status: http.StatusInternalServerError, Code: "server_error", Message: "internal error",
	}
}
