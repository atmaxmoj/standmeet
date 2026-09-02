// tools.go —— Phase D-3: the per-tool dispatch HTTP endpoint.
//
// URL: POST /api/v1/sessions/{conv_id}/tools/{tool_name}
// Auth: Bearer visitor session token (shared with /messages)
// Body: raw JSON tool args (passed through unchanged to the capability binding's
// Execute)
//
// Behavior:
//   1. auth → get session data
//   2. assemble bindings through Registry.AssembleVisitor (same-source gating as the
//      chat path)
//   3. look up the binding by tool name; not found → 404 capability_not_enabled
//   4. execute the tool; returns {ok:true, result, capability_state} or a tool error
//      envelope; capability_state is always returned so the frontend zustand store
//      stays in sync (a quota-cascade scenario: quota runs out mid-tool, and the
//      frontend needs to see enabled=false right away)
//
// Shares its capability-assembly code with the chat path → identical behavior; the
// frontend pi-agent-core's ToolDispatcher port implementation is just fetching this
// endpoint.

package public

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
)

// methodQuery —— HTTP QUERY (RFC 10008): a safe/idempotent query that carries a body.
// Read-only tools can be called through it. chi's default method table doesn't include
// QUERY, so the composition root (server.go) registers it with chi.RegisterMethod at
// startup.
const methodQuery = "QUERY"

// isQueryOnMutating —— a QUERY hitting a state-changing (non-read-only) tool → refused
// (405). QUERY's semantics promise safe/idempotent, so a state-changing tool can only
// go through POST.
func isQueryOnMutating(method string, t *capreg.BindingTool) bool {
	return method == methodQuery && !t.ReadOnly
}

// toolDispatch handler —— the single entry point handling any per-tool call (POST for
// every tool; QUERY for read-only tools only).
func (h *Handlers) toolDispatch() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		auth, ok := authVisitorWithToken(h, w, r)
		if !ok {
			return
		}
		body, berr := io.ReadAll(r.Body)
		if berr != nil {
			h.Log.Warn("tool dispatch read body", "err", berr)
			writeToolErr(h.Log, w, toolErr{
				Status: http.StatusBadRequest, Reason: "invalid_body",
				Detail: "invalid request body",
			})
			return
		}
		toolName := chi.URLParam(r, "tool_name")
		convID := chi.URLParam(r, "id")
		runToolDispatch(r.Context(), h, w, &toolDispatchArgs{
			Data: auth.Data, ToolName: toolName,
			ConvID: convID, Body: body, Method: r.Method,
		})
	}
}

// slowAssembleThreshold —— logs one line once this is exceeded. **Not an arbitrary
// pick**: the visitor-side card only waits 5 seconds for a result before it shows
// "send failed" (while the backend has often already finished). So 2s marks "not
// broken yet, but heading there" — logging it is the only chance to see it before it
// turns into an actual failure.
const slowAssembleThreshold = 2 * time.Second

func logSlowAssemble(log *slog.Logger, tool string, took time.Duration) {
	if took < slowAssembleThreshold {
		return
	}
	log.Warn("visitor tool assemble slow",
		"tool", tool, "ms", took.Milliseconds(),
		"note", "capability assembly (sandbox start) — the visitor is staring at a dead button")
}

type toolDispatchArgs struct {
	Data     *access.VisitorSessionData
	ToolName string
	ConvID   string
	Method   string
	Body     []byte
}

// runToolDispatch —— splits out assembly + dispatch + the response flow, keeping the
// handler's cyclo ≤ 3.
func runToolDispatch(
	ctx context.Context, h *Handlers, w http.ResponseWriter, args *toolDispatchArgs,
) {
	in := assembleInputFromSession(args.Data, args.ConvID)
	// This assembly step has to spin capabilities up (sandbox container / bwrap
	// namespace). **It's the most expensive part of this path**, and how expensive
	// depends on the machine's load at that moment: ~1s when idle, seen as high as 19s
	// under load — meanwhile the visitor clicked "send confirmation email" and the UI
	// gave them no feedback for ten-plus seconds, so they think it failed and click
	// again.
	//
	// ForTool: this path only ever needs one tool, so it only dials the capability
	// that might provide it (see capreg's registry_tool_dispatch.go). It used to dial
	// every capability once, then dial them all again when returning state after
	// execution — 2N sandboxes per click.
	//
	// The per-segment timing stays here because the last time this was investigated
	// there was only one total HTTP duration, with no way to tell whether assembly was
	// slow or the tool itself was — the conclusion could only stop at "slow under
	// load".
	assembleStart := time.Now()
	bindings := h.Visitor.AgentSkills.AssembleVisitorForTool(ctx, in, args.ToolName)
	defer closeBindings(bindings)
	logSlowAssemble(h.Log, args.ToolName, time.Since(assembleStart))
	tool, found := findBindingTool(bindings, args.ToolName)
	if !found {
		writeToolErr(h.Log, w, toolErr{
			Status: http.StatusNotFound, Reason: "capability_not_enabled",
			Detail:   "tool not exposed in this session",
			CapState: h.Visitor.AgentSkills.VisitorStates(ctx, in),
		})
		return
	}
	if isQueryOnMutating(args.Method, tool) {
		writeToolErr(h.Log, w, toolErr{
			Status: http.StatusMethodNotAllowed, Reason: "method_not_allowed",
			Detail:   "QUERY is only for read-only tools; use POST",
			CapState: h.Visitor.AgentSkills.VisitorStates(ctx, in),
		})
		return
	}
	executeAndRespond(ctx, h, w, executeArgs{
		In: in, ToolName: args.ToolName, Body: args.Body, Tool: tool,
		ConvID: args.ConvID,
	})
}

type executeArgs struct {
	In       *capreg.AssembleInput
	Tool     *capreg.BindingTool
	ToolName string
	// ConvID —— which conversation this call happens inside. Needed so "what the
	// visitor did on the card" can be written back into that conversation (F-B-9) —
	// before this, the path knew nothing about the conversation at all.
	ConvID string
	Body   []byte
}

func executeAndRespond(
	ctx context.Context, h *Handlers, w http.ResponseWriter, args executeArgs,
) {
	out, execErr := args.Tool.Tool.InvokableRun(ctx, string(args.Body))
	capState := h.Visitor.AgentSkills.VisitorStates(ctx, args.In)
	if execErr != nil {
		// Raw executor error → log (ops); client sees a static detail so no
		// executor/provider internals leak into the visitor's browser.
		h.Log.Warn("tool dispatch exec", "tool", args.ToolName, "err", execErr)
		writeToolErr(h.Log, w, toolErr{
			Status: http.StatusInternalServerError, Reason: "tool_error",
			Detail: "tool execution failed", CapState: capState,
		})
		return
	}
	recordCardEvent(ctx, h, args, out)
	writeToolOK(h.Log, w, out, capState)
}

// recordCardEvent —— writes **this call dispatched from a card** back into this
// conversation (F-B-9).
//
// Why it's here: this path never touched the conversation from start to finish —
// assemble, execute, return. So a meeting the visitor canceled on the card had, as far
// as the agent was concerned, never happened, and after one refresh even the client's
// own record was gone, and it never once showed up in the owner's transcript either.
//
// The wording matches the client side **verbatim** (`[card action] …`): when the same
// event shows up worded differently in two places, the reader (and the model) treats
// it as two different events.
//
// best-effort: a failure to record this shouldn't turn an already-completed tool call
// into a failed one — that would be lying to the visitor. The failure should be loud,
// otherwise "something happened on the card but not in the conversation" becomes a
// silent norm.
func recordCardEvent(
	ctx context.Context, h *Handlers, args executeArgs, out string,
) {
	text := fmt.Sprintf(
		"[card action] The visitor used %q on a card in this conversation. Result: %s",
		args.ToolName, out,
	)
	if err := conversation.RecordCardEvent(ctx, &conversation.DialogDeps{
		Chats: h.Visitor.Chats, Corpus: h.Corpus,
		Subjectivity: h.Subjectivity, Log: h.Log,
	}, args.ConvID, text); err != nil {
		h.Log.Warn("record card event", "tool", args.ToolName, "err", err)
	}
}

// findBindingTool —— walks bindings looking for a tool matching name. Only the first
// same-named match is taken (the design assumes capability registration order never
// collides on name).
func findBindingTool(
	bindings []*capreg.Binding, name string,
) (*capreg.BindingTool, bool) {
	for _, b := range bindings {
		if t, ok := findToolInBinding(b, name); ok {
			return t, true
		}
	}
	return nil, false
}

func findToolInBinding(
	b *capreg.Binding, name string,
) (*capreg.BindingTool, bool) {
	for i := range b.Tools {
		if b.Tools[i].Name == name {
			return &b.Tools[i], true
		}
	}
	return nil, false
}

// closeBindings —— releases the binding resources assembly produced (ext-mcp sessions
// etc). Same close pattern as the chat path; deferred once at the top of the handler.
func closeBindings(bindings []*capreg.Binding) {
	for _, b := range bindings {
		if b.Close != nil {
			b.Close()
		}
	}
}

type toolOKResp struct {
	Result          json.RawMessage          `json:"result"`
	CapabilityState []capreg.CapabilityState `json:"capability_state"`
	OK              bool                     `json:"ok"`
}

type toolErrResp struct {
	Reason          string                   `json:"reason"`
	Detail          string                   `json:"detail,omitempty"`
	CapabilityState []capreg.CapabilityState `json:"capability_state,omitempty"`
	OK              bool                     `json:"ok"`
}

func writeToolOK(
	log *slog.Logger, w http.ResponseWriter,
	executorOut string, capState []capreg.CapabilityState,
) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	resp := toolOKResp{
		OK: true, Result: rawOrQuoted(executorOut), CapabilityState: capState,
	}
	if err := json.NewEncoder(w).Encode(&resp); err != nil {
		log.Error("tool dispatch encode ok", "err", err)
	}
}

type toolErr struct {
	Reason   string
	Detail   string
	CapState []capreg.CapabilityState
	Status   int
}

func writeToolErr(
	log *slog.Logger, w http.ResponseWriter, e toolErr,
) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(e.Status)
	resp := toolErrResp{
		OK: false, Reason: e.Reason, Detail: e.Detail, CapabilityState: e.CapState,
	}
	if err := json.NewEncoder(w).Encode(&resp); err != nil {
		log.Error("tool dispatch encode err", "err", err)
	}
}

// rawOrQuoted —— the executor usually returns a JSON string; wraps it as one when it
// isn't.
func rawOrQuoted(s string) json.RawMessage {
	if json.Valid([]byte(s)) {
		return json.RawMessage(s)
	}
	quoted, err := json.Marshal(s)
	if err != nil {
		return json.RawMessage(`null`)
	}
	return quoted
}
