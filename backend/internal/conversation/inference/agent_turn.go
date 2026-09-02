// agent_turn.go —— HTTP exit point for POST /api/v1/agent/turn: wires the transport-agnostic
// agentic core (agent_loop.go) to the browser's pi SSE.
//
//	RunAgentTurn = BuildAgentIterator (pre-stream) + sseSink + DriveAgentLoop
// The loop itself (build model + ADK ChatModelAgent + consume events) lives in agent_loop.go,
// programmed against AgentSink; this file only supplies sseSink, writing each event as a pi
// unified SSE frame (text / tool_started / tool_completed / ghosts / done / error). eval-harness
// reuses the same loop, injecting its own sink.

package inference

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/cloudwego/eino/components/tool"
)

// defaultAgentTurnTimeout —— hard cap on one agent loop turn (all iterations + trailing
// ghosts). A third-party LLM can hang on a large context; the SSE ctx stays alive as long as
// the browser holds the connection, so with no deadline it waits forever (frontend stuck
// "retrieving"). On timeout, cancel the in-flight LLM call and wrap up via handleTerminalError.
// AGENT_TURN_TIMEOUT (seconds) overrides it (e2e sets it short).
//
// Sized WITH maxAgentIterations(24): that budget legitimizes multi-minute crawls on a real
// vault; a 120s cap killed them at the time wall instead (observed: broad question → 26
// retrievals → "That took too long", evidence discarded). The two budgets must agree.
const defaultAgentTurnTimeout = 300 * time.Second

func agentTurnTimeout() time.Duration {
	if s := os.Getenv("AGENT_TURN_TIMEOUT"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			return time.Duration(n) * time.Second
		}
	}
	return defaultAgentTurnTimeout
}

// The on-wire shapes (AgentTurnRequest / AgentDocContext) split out to agent_turn_wire.go; the
// generic composer (doc / date+tz / cross-conv / session notes) to agent_instruction.go.

// AgentTurnInput —— bundles the arguments for RunAgentTurn / BuildAgentIterator, avoiding
// revive's 5-arg cap. Field order follows govet fieldalignment: the 3 pointers first, slices
// after.
//
// ProgressLabels —— tool name → throbber copy; since H.11 the tool_started SSE frame carries a
// progress_label field to the browser, read directly by the frontend instead of going through a
// local zustand-registry lookup. Filled in by the caller (route handler); inference doesn't know
// which capability registered which label — zero cross-package coupling.
//
// Mode —— visitor session mode (public / code / byoai). Since H.13, a code-accessor session
// emits a `ghosts` SSE event (follow-up chips) before wrap-up; public / byoai never produce chips.
type AgentTurnInput struct {
	Cred           *Cred
	Req            *AgentTurnRequest
	ProgressLabels map[string]string
	// ReturnDirectly —— I.1: tool name → true ends the agent loop the moment that call finishes,
	// without one more LLM turn (used for echo-only tools like ask_visitor). nil/empty = every
	// tool goes through the default react loop.
	ReturnDirectly map[string]bool
	// Persist —— #28: the persistence port. When the loop wraps up (AI produced content), it
	// sinks the accumulated TurnResult into the conversation table. nil = don't persist
	// (stateless smoke call, no conversation). The route handler injects a closure wired
	// through RecordDialog; inference never touches the DB.
	Persist PersistFunc
	// RecordUsage —— #106 billing: at end of turn, hands out this turn's accumulated token
	// usage. The route handler injects a closure wired to inference_usage (closes over
	// owner_id; BYOAI passes a no-op — a visitor paying their own way isn't billed to the
	// owner). nil = not recorded (stateless smoke / no owner). inference never touches the DB.
	RecordUsage RecordUsageFunc
	// MarkWaypoints —— the ghost-steering ledger port. At end of turn, hands out this turn's
	// citations + booking hits; the route handler's closure marks waypoints visited and saves
	// them to the session. nil = don't mark (not code / no waypoints).
	MarkWaypoints MarkWaypointsFunc
	// BuildGhost —— the ghost-steering policy port. After done, produces at most one steering
	// ghost from this turn's final reply (a route closure: GhostPolicy LLM + writes to
	// conversation_ghosts). nil = don't produce one (not code / no waypoints).
	Epilogue EpilogueFunc
	// TurnEnded —— the "this turn is over for the visitor" callback, invoked the instant the
	// `done` frame is sent (after persistence).
	//
	// The route handler uses it to **release this turn's concurrency slot**. The slot used to
	// release via `defer release()`, waiting for the handler to return — but the handler still
	// runs the epilogue after done (a real ghost LLM call, measured 10-26s in prod). So after
	// the visitor got the "finished" receipt, the session would stay busy server-side, and the
	// next question would get **immediately rejected** (not queued) by query_queue.go's
	// per-session single-flight gate — the server-side half of F-A-42.
	//
	// Semantic boundary: done = committed (persistence happens before it), so releasing the
	// slot here can't let the next turn read half-written history. nil = don't release (no
	// queue at this call site). The call must be idempotent — route keeps a defer as backstop.
	TurnEnded func()
	Mode      string
	// CrossConvContext —— "cross-talk": a digest of this member's other conversations.
	// instructionWithCrossConv appends it to keep the AI coherent across conversations; the
	// route handler fills it in (reads the DB), inference never touches the DB. Empty = not
	// injected (public / no member / no other conversations).
	CrossConvContext string
	// OwnerTimezone —— the owner's IANA tz (owners.profile_timezone). instructionWithDateTime
	// anchors "current time + timezone" into the generic instruction. Empty → falls back to
	// UTC. Filled in by the route handler (reads the owner); inference never touches the DB.
	OwnerTimezone string
	// VisitorTimezone —— the visitor's browser tz (passed through from AgentTurnRequest).
	// instructionWithDateTime uses it to tell the agent the visitor's timezone, so interpreting
	// times the visitor gives (especially for booking) is no longer ambiguous (#120).
	VisitorTimezone string
	Tools           []tool.BaseTool
	// ClaimGates —— "if it says so, it must have happened" conditions declared by the
	// capabilities granted this session (from the manifest at assembly time). Empty = this
	// turn has no claims needing a receipt. See agent_claim_gate.go.
	ClaimGates []ClaimGate
	// SessionNotes —— facts that only became true **after the session started** (quota ran
	// out, a connector went offline).
	//
	// The visitor's system prompt is fixed when the session is assembled by the client —
	// anything true mid-session has no other way in. The route handler fills it in (queries
	// the registry); inference only appends it into the instruction. Empty = no new facts.
	// See F-B-14.
	SessionNotes []string
}

// RunAgentTurn —— runs one entire agent loop turn, writing pi-style SSE to w. The caller (route
// handler) already did auth + body parsing + cred resolution. A pre-stream failure (model build /
// msg parsing) goes through writeProxyErr (HTTP status + one error frame); once streaming starts,
// everything goes out as SSE frames through sseSink.
func RunAgentTurn(
	ctx context.Context, log *slog.Logger, w http.ResponseWriter, in *AgentTurnInput,
) {
	timeout := agentTurnTimeout()
	// #28: detached ctx —— runs on a context detached from the request, so a client disconnect
	// (refresh / closed tab) no longer cancels it. The stream still runs to completion and still
	// sinks into the DB; timeout still caps it (cancels the in-flight LLM call over the cap).
	// Fine if the display sink fails to write (connection gone) — just log it, don't abort.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), timeout)
	defer cancel()
	ctx = withLLMLog(ctx, log) // so the retry transport (http_retry.go) can log
	start := time.Now()
	log.Info("agent turn start", "model", credModel(in.Cred), "mode", in.Mode,
		"tools", len(in.Tools), "timeout_s", int(timeout.Seconds()))

	sink := &sseSink{log: log, w: w, flusher: pickFlusher(w)}
	// The retry notifier rides the ctx down to the transport (http_retry.go): before each
	// backoff it calls sink.Retrying, emitting a `retrying` frame. Wired in before
	// BuildAgentIterator, so the model call's ctx already carries the callback.
	ctx = withRetryNotifier(ctx, sink.Retrying)

	iter, err := BuildAgentIterator(ctx, in)
	if err != nil {
		log.Error("agent turn build failed", logErrKey, err,
			"dur_ms", time.Since(start).Milliseconds())
		writeProxyErr(log, w, err)
		return
	}
	setStreamSSEHeaders(w)
	extendStreamWriteDeadline(log, w, timeout)
	// accumSink tees the display sink + accumulates for the end of the stream; at wrap-up
	// (before Done) it sinks this turn into the DB (on the detached ctx, so it lands even if
	// the client disconnected). Persisted before Done → `done` means "already committed".
	acc := newAccumSink(sink)
	acc.onDone = func() {
		persistTurn(ctx, log, in, acc)
		markWaypointsTurn(ctx, in, acc)
		// Slot released after persistence, before `done` is written: the instant the visitor
		// gets the receipt, this session stops being busy server-side. The epilogue that runs
		// after is background bookkeeping — shouldn't make the next question hit a wall (F-A-42).
		if in.TurnEnded != nil {
			in.TurnEnded()
		}
	}
	DriveAgentLoop(ctx, log, in, iter, acc)

	dur := time.Since(start)
	logAgentTurnEnd(ctx, log, dur, timeout)
}

// writeDeadlineGrace —— extra time the write deadline keeps beyond the agent turn ctx timeout,
// so once the ctx times out the sink still has time to flush the error/done frame.
const writeDeadlineGrace = 15 * time.Second

// extendStreamWriteDeadline —— fixes the root cause of "a long turn gets cut off mid-way by
// http.Server.WriteTimeout (30s)". WriteTimeout caps finishing the write of **the entire
// response**, fine for a regular endpoint, but an SSE stream keeps writing until the turn ends;
// a turn over 30s gets its connection closed by the server mid-way → browser gets
// ERR_INCOMPLETE_CHUNKED_ENCODING, frontend stuck "retrieving" forever. ResponseController
// pushes **this connection's** write deadline out beyond the agent turn timeout; the real cap
// stays the ctx WithTimeout above. Writers without deadline support (httptest.Recorder etc.)
// return ErrNotSupported — just log it, the stream is still governed by the ctx.
// The boundary's rescue attempt runs **after the time wall** (detached ctx + its own budget),
// so this deadline must account for it too. Under-counting was measured in prod (F-A-44): turn
// hits the wall at 300s → rescue spends another 60s → `done` gets written at 360s, but the
// write timeout was 315s — connection already cut by the server, browser **never got that
// frame**. Backend judged correctly (`stop=deadline`), visitor still saw the SDK's "no done
// frame seen" fallback. Judging right but never delivering it is no different from judging wrong.
func extendStreamWriteDeadline(log *slog.Logger, w http.ResponseWriter, timeout time.Duration) {
	rc := http.NewResponseController(w)
	budget := timeout + forceFinalTimeout() + writeDeadlineGrace
	if err := rc.SetWriteDeadline(time.Now().Add(budget)); err != nil {
		log.Warn("agent turn: extend write deadline unsupported (stream capped by ctx only)",
			logErrKey, err)
	}
}

// logAgentTurnEnd —— wrap-up log: normal completion logs info; hitting the deadline logs warn,
// to make a "hang" visible in the logs (previously a timed-out LLM call logged nothing).
func logAgentTurnEnd(ctx context.Context, log *slog.Logger, dur, timeout time.Duration) {
	if ctx.Err() == context.DeadlineExceeded {
		log.Warn("agent turn TIMED OUT — upstream LLM too slow / stalled",
			"dur_ms", dur.Milliseconds(), "timeout_s", int(timeout.Seconds()))
		return
	}
	log.Info("agent turn done", "dur_ms", dur.Milliseconds())
}

// credModel —— nil-safe model name, for logging.
func credModel(c *Cred) string {
	if c == nil {
		return ""
	}
	return c.Model
}

// sseSink —— the prod implementation of AgentSink: writes each agent loop event as one pi
// unified SSE frame pushed to the browser.
//
// mu —— Retrying fires from the transport inside eino's model-call goroutine, and can collide
// with the main DriveAgentLoop goroutine writing Text/ToolStarted; every method writes its
// whole frame inside the lock, so SSE frames never interleave (frame-granular atomicity).
type sseSink struct {
	log     *slog.Logger
	w       http.ResponseWriter
	flusher http.Flusher
	mu      sync.Mutex
}

// shownResult —— can this tool call's result go out live, unchanged.
//
// **Right now it goes out unchanged — the half of F-A-28 still not closed.** The retrieval
// result contains note body text (including private subjectivity); the persistence path already
// strips it (history.go goes through VisitorToolCalls), the live path has not.
//
// Can't just strip it here: **the visitor's citation footnotes are computed by the frontend
// from these results.** Stripping result would make the footer disappear entirely
// (visitor-chat-tool-cards would go red immediately). So the show_as_source gate the design
// relies on is really a browser-side filter over a payload that already contains private body
// text — the server sends everything, the client decides what to display.
//
// To close this half, the server needs to emit citations as their own frame (already computed,
// right there in history's return value), so the footer stops depending on raw result. That's a
// streaming-protocol change, not an `if` added here.
func shownResult(_, result string) string {
	return result
}

var _ AgentSink = (*sseSink)(nil)

func (s *sseSink) Text(delta string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	emitTextDelta(s.log, s.w, s.flusher, delta)
}

func (s *sseSink) ToolStarted(id, name, progressLabel string, args json.RawMessage) {
	s.mu.Lock()
	defer s.mu.Unlock()
	body, err := json.Marshal(toolStartedPayload{
		ID: id, Name: name, Args: args, ProgressLabel: progressLabel,
	})
	if err != nil {
		s.log.Error("agent turn marshal tool_started", logErrKey, err)
		return
	}
	writeSSEFrame(s.log, s.w, s.flusher, "tool_started", body)
}

// ToolCompleted —— sends one tool call's result out live. The result first passes through
// shownResult: which tools' results are safe to show the other side is a **product rule**,
// injected by the caller (AgentTurnInput.ShowToolResult) — the kernel names no specific tool.
// Accumulated citations go through accumSink, reading the same raw result, unaffected by this
// filtering.
func (s *sseSink) ToolCompleted(name, result string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	body, err := json.Marshal(toolCompletedPayload{
		Name: name, Result: shownResult(name, result),
	})
	if err != nil {
		s.log.Error("agent turn marshal tool_completed", logErrKey, err)
		return
	}
	writeSSEFrame(s.log, s.w, s.flusher, "tool_completed", body)
}

// Epilogue —— emits a single post-`done` frame as an SSE event named by f.Kind (e.g. "ghost"),
// f.Payload as the data. The kernel names neither the frame kind nor its shape — route does.
func (s *sseSink) Epilogue(f *EpilogueFrame) {
	s.mu.Lock()
	defer s.mu.Unlock()
	writeSSEFrame(s.log, s.w, s.flusher, f.Kind, f.Payload)
}

func (s *sseSink) Retrying(attempt int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	body, err := json.Marshal(retryingPayload{Attempt: attempt})
	if err != nil {
		s.log.Error("agent turn marshal retrying", logErrKey, err)
		return
	}
	writeSSEFrame(s.log, s.w, s.flusher, "retrying", body)
}

func (s *sseSink) Error(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	emitError(s.log, s.w, s.flusher, err)
}

func (s *sseSink) Done(stop string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	emitDone(s.log, s.w, s.flusher, stop)
}

type toolStartedPayload struct {
	ID            string          `json:"id"`
	Name          string          `json:"name"`
	ProgressLabel string          `json:"progress_label,omitempty"`
	Args          json.RawMessage `json:"args"`
}

type toolCompletedPayload struct {
	Name   string `json:"name"`
	Result string `json:"result"`
}

// retryingPayload —— payload of an SSE `retrying` frame. attempt is which retry (from 1).
type retryingPayload struct {
	Attempt int `json:"attempt"`
}
