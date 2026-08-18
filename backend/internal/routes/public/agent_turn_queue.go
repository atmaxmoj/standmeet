// agent_turn_queue.go —— #7 visitor-turn concurrency guard wiring. Split from agent_turn.go to keep
// it under the file-length limit. The QueryQueue was constructed but never consulted; runAgentTurn
// now acquires a slot (per-session single-flight + global cap) and releases it on turn end.

package public

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/atmaxmoj/standmeet/internal/conversation/inference"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/session"
)

// dispatchTurn —— after a slot is acquired: resolve cred, preflight quota, assemble tools, run the
// agent turn (streams SSE). Split out of runAgentTurn to keep both within the route-cyclo budget.
//
// slot 把「这一场是谁」和「什么时候把槽还回去」绑在一起 —— 它们是同一件事的两半：
// 槽是按 session token 拿的,也按它还(参数闸门顺手逼出了这个更准确的形状)。
func dispatchTurn(
	h *Handlers, w http.ResponseWriter, r *http.Request,
	slot turnSlot, req *inference.AgentTurnRequest,
) {
	auth := slot.auth
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
		ClaimGates:       ts.ClaimGates,
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
		TurnEnded:        slot.release,
	})
}

// turnSlot —— 这一轮占着的并发槽:凭谁拿的(auth),以及怎么还(release,幂等)。
// release 走 `TurnEnded`(done 帧那一刻)而不是 handler 返回,见 AgentTurnInput.TurnEnded。
type turnSlot struct {
	release func()
	auth    authedVisitor
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
	// 幂等:两处会调它 —— `done` 帧那一刻(正常路径,让 epilogue 不再占着这一场)和 handler
	// 的 defer(兜底,给根本走不到 done 的路径)。Once 让「调两次」不再是调用方要记住的纪律
	// ([[structure-means-no-responsibility-class]])。
	var once sync.Once
	return func() { once.Do(func() { q.Release(sessionID) }) }, nil
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
