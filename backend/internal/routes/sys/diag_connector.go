// diag_connector.go —— POST /internal/diag/connector/{id}/{invoke,agent-call}
//
// Owner-authed diag: hits a connector directly (by id, bypassing the active slot) to run
// one thing and echoes back its raw result. Verifies end-to-end that the binding the owner
// just uploaded (response extraction / request construction) is correct — no visitor session.
//
// **This layer knows no category.** It takes three strings plus an opaque JSON blob
// (category, verb, args), forwards it, and echoes the result back verbatim. This used to
// be three routes — `/list-busy` `/create-event` `/send` — each holding a typed proxy that
// translated friendly input into a category DTO. So **this face** (the route layer) knew
// that a meeting is made of summary/start-end/timezone/attendees, that an email is made of
// to/subject/body. The names are gone; the shape remained.
//
// The right shape was already sitting in this same file: `/agent-call` was always generic
// (call by op + args). Now both routes are. Category knowledge moved to the caller — it's
// outside the kernel.

package sys

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
)

// ErrConnectorNotFound —— this id isn't registered, or it isn't a connector of the
// category being called.
//
// **This layer's own sentinel**, not borrowed from the connector layer: borrowing one
// would mean importing that package, and all this route needs to know is "wrong address"
// vs. "the call failed". The composition root is responsible for translating the
// connector layer's equivalent error into this one (see cmd/server/boot_wireup.go).
var ErrConnectorNotFound = errors.New("connector not found")

// AgentCallFn —— runs an agent-tool op by id (auth-injected SaaS call), returning the raw
// response or an error (diag route that verifies the path directly).
type AgentCallFn func(
	ctx context.Context, id, ownerID, op string, args json.RawMessage,
) (json.RawMessage, error)

// CategoryInvokeFn —— runs a **category verb** by id, returning the normalized raw JSON.
// Category and verb are both strings, so this layer literally cannot write a
// category-specific type.
type CategoryInvokeFn func(
	ctx context.Context, ownerID, id, category, verb string, args json.RawMessage,
) (json.RawMessage, error)

// DiagConnectorDeps —— the two paths needed to hit a connector directly (the composition
// root wires the concrete implementations).
type DiagConnectorDeps struct {
	Invoke    CategoryInvokeFn
	AgentCall AgentCallFn
	Log       *slog.Logger
}

// MountDiagConnector —— mounts connector diag (caller already wraps owner-session
// middleware).
func MountDiagConnector(r chi.Router, deps DiagConnectorDeps) {
	r.Post("/diag/connector/{id}/invoke", diagInvoke(deps))
	r.Post("/diag/connector/{id}/agent-call", diagAgentCall(deps))
}

type diagAgentCallReq struct {
	Op   string          `json:"op"`
	Args json.RawMessage `json:"args"`
}

// diagAgentCall —— owner runs an agent-tool (op) directly: auth-injected SaaS call,
// proving the runtime path (§3 [A6]). Success -> 200 {ok:true}; a run failure -> friendly
// 200 {ok:false} (no leaking internals; the real error goes to the log).
func diagAgentCall(deps DiagConnectorDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req diagAgentCallReq
		if !diagDecode(deps.Log, w, r, &req) {
			return
		}
		owner := middleware.OwnerIDFrom(r.Context())
		_, cerr := deps.AgentCall(r.Context(), chi.URLParam(r, "id"), owner, req.Op, req.Args)
		if cerr != nil {
			deps.Log.Warn("diag agent-call failed", "op", req.Op, "err", cerr)
			diagStatus(deps.Log, w, http.StatusOK, map[string]bool{"ok": false})
			return
		}
		diagStatus(deps.Log, w, http.StatusOK, map[string]bool{"ok": true})
	}
}

// diagInvokeReq —— which category, which verb, args passed through as-is.
type diagInvokeReq struct {
	Category string          `json:"category"`
	Op       string          `json:"op"`
	Args     json.RawMessage `json:"args"`
}

// diagInvokeResp —— the response is echoed back **verbatim** (result is the connector
// side's already-normalized JSON). This layer does not reorder, rename, or reformat it —
// it can't understand what's inside, and shouldn't.
//
// On failure, Error carries the **real reason**. diag is an owner-authed diagnostic port;
// its entire reason to exist is "tell me why my binding doesn't work" — hiding the reason
// in the server log would defeat the endpoint. (The visitor-facing "don't leak internals"
// rule doesn't apply here: only the owner can hit this route.)
//
// Field order follows pointer width — enforced by govet fieldalignment.
type diagInvokeResp struct {
	Error  string          `json:"error,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
	OK     bool            `json:"ok"`
}

// diagInvoke —— hits one category verb on a connector directly.
//
// Connector doesn't exist / isn't this category -> 404; a run failure -> friendly
// 200 {ok:false} (the underlying error goes to the log, not to the caller — diag is
// still a face).
func diagInvoke(deps DiagConnectorDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req diagInvokeReq
		if !diagDecode(deps.Log, w, r, &req) {
			return
		}
		if !req.complete() {
			diagStatus(deps.Log, w, http.StatusBadRequest,
				map[string]string{"error": "category and op are required"})
			return
		}
		runDiagInvoke(r.Context(), deps, w, chi.URLParam(r, "id"), &req)
	}
}

// complete —— both category and verb are required: this layer knows no category, so it
// can't supply a default either.
func (q *diagInvokeReq) complete() bool { return q.Category != "" && q.Op != "" }

// runDiagInvoke —— forwards the call and translates the receipt. Branching stays here;
// the handler only decodes and dispatches.
func runDiagInvoke(
	ctx context.Context, deps DiagConnectorDeps, w http.ResponseWriter,
	id string, req *diagInvokeReq,
) {
	out, err := deps.Invoke(ctx, middleware.OwnerIDFrom(ctx),
		id, req.Category, req.Op, argsOrEmpty(req.Args))
	if err != nil {
		diagInvokeErr(deps.Log, w, req.Category, req.Op, err)
		return
	}
	diagStatus(deps.Log, w, http.StatusOK, diagInvokeResp{OK: true, Result: out})
}

// argsOrEmpty —— no args given means treat it as an empty object. Some verbs (connected /
// probing a default range) genuinely need no args.
func argsOrEmpty(a json.RawMessage) json.RawMessage {
	if len(a) == 0 {
		return json.RawMessage(`{}`)
	}
	return a
}

// diagInvokeErr —— two cases: "this connector isn't this category" is a wrong address
// (404); "the run failed" is this call not succeeding (400 + reason). **The reason goes
// back verbatim** — see the diagInvokeResp comment.
func diagInvokeErr(
	log *slog.Logger, w http.ResponseWriter, category, op string, err error,
) {
	if errors.Is(err, ErrConnectorNotFound) {
		diagStatus(log, w, http.StatusNotFound, map[string]string{"error": "connector not found"})
		return
	}
	log.Warn("diag invoke failed", "category", category, "op", op, "err", err)
	diagStatus(log, w, http.StatusBadRequest, diagInvokeResp{OK: false, Error: err.Error()})
}

// diagBody —— the two request-body shapes this layer can decode. `any` is banned in
// business code: an opaque decode target throws away the readability of "what does
// this route accept".
type diagBody interface {
	*diagInvokeReq | *diagAgentCallReq
}

func diagDecode[T diagBody](log *slog.Logger, w http.ResponseWriter, r *http.Request, dst T) bool {
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		diagStatus(log, w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return false
	}
	return true
}

// diagPayload —— the response shapes this layer sends back. Also no `any`.
type diagPayload interface {
	diagInvokeResp | map[string]string | map[string]bool
}

func diagStatus[T diagPayload](log *slog.Logger, w http.ResponseWriter, status int, v T) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Error("diag encode", "err", err)
	}
}
