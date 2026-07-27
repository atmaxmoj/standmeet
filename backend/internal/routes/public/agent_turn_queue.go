// agent_turn_queue.go —— #7 visitor-turn concurrency guard wiring. Split from agent_turn.go to keep
// it under the file-length limit. The QueryQueue was constructed but never consulted; runAgentTurn
// now acquires a slot (per-session single-flight + global cap) and releases it on turn end.

package public

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/atmaxmoj/standmeet/internal/inference"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/session"
)

// dispatchTurn —— after a slot is acquired: resolve cred, preflight quota, assemble tools, run the
// agent turn (streams SSE). Split out of runAgentTurn to keep both within the route-cyclo budget.
func dispatchTurn(
	h *Handlers, w http.ResponseWriter, r *http.Request,
	auth authedVisitor, req *inference.AgentTurnRequest,
) {
	cred, cerr := resolveAgentTurnCred(r, h, auth)
	if cerr != nil {
		writeLLMPreStreamErr(h, w, cerr)
		return
	}
	if !preflightAgentTurnQuota(r, h, auth, w, req.ConversationID) {
		return
	}
	ts := collectVisitorTools(r.Context(), h, auth, req.ConversationID)
	defer closeBindings(ts.Bindings)
	inference.RunAgentTurn(r.Context(), h.Log, w, &inference.AgentTurnInput{
		Cred: cred, Req: req,
		Tools:            ts.Tools,
		ProgressLabels:   ts.Labels,
		ReturnDirectly:   ts.ReturnDirectly,
		Mode:             auth.Data.Mode,
		Persist:          buildAgentTurnPersist(h, auth, req.ConversationID),
		RecordUsage:      buildAgentTurnUsage(h, auth),
		CrossConvContext: buildCrossConvForTurn(r, h, auth, req.ConversationID),
		OwnerTimezone:    ownerTZForTurn(r, h, auth.Data.OwnerID),
		VisitorTimezone:  req.VisitorTimezone,
		MarkWaypoints:    buildAgentTurnLedger(h, auth),
		Epilogue:         buildGhostForTurn(h, auth, cred, req.ConversationID),
	})
}

// turnQueueTimeout —— max wait for a global concurrency slot before returning "server busy".
const turnQueueTimeout = 30 * time.Second

// acquireOrReject —— acquire a turn slot; on refusal write the busy status and return ok=false so
// the handler stops. Keeps runAgentTurn's cyclomatic complexity within the route budget.
func acquireOrReject(
	h *Handlers, w http.ResponseWriter, r *http.Request, auth authedVisitor,
) (func(), bool) {
	release, err := acquireTurnSlot(r.Context(), h.QueryQueue, auth.Token)
	if err != nil {
		writeTurnBusyErr(h, w, err)
		return nil, false
	}
	return release, true
}

// acquireTurnSlot —— enforce the visitor-turn concurrency guard: per-session single-flight + global
// cap. Returns a release func (call on turn end). A nil queue (unset) is a no-op.
func acquireTurnSlot(
	ctx context.Context, q *session.QueryQueue, sessionID string,
) (func(), error) {
	if q == nil {
		return func() {}, nil
	}
	if err := q.Acquire(ctx, sessionID, turnQueueTimeout); err != nil {
		return nil, err
	}
	return func() { q.Release(sessionID) }, nil
}

// writeTurnBusyErr —— map the queue's refusal to a user-friendly status (429 own-session busy, 503
// global saturation), never a raw error.
func writeTurnBusyErr(h *Handlers, w http.ResponseWriter, err error) {
	if errors.Is(err, session.ErrSessionBusy) {
		writeError(h.Log, w, apierr.Envelope{
			Status:  http.StatusTooManyRequests,
			Code:    "session_busy",
			Message: "You already have a message in progress — wait for it to finish.",
		})
		return
	}
	writeError(h.Log, w, apierr.Envelope{
		Status:  http.StatusServiceUnavailable,
		Code:    "server_busy",
		Message: "The server is busy right now — please try again in a moment.",
	})
}
