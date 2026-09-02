// script.go —— admin registry + handlers for e2e scripting.
//
// **Keyword KV, matched by containment.** A test registers key→value (key is a
// unique keyword the test picks, e.g. a uuid) and embeds that keyword in the
// message it sends. On each /v1/messages the mock scans its registered keys and,
// for the first one the request text CONTAINS, returns that value (single-shot:
// consumed on match so an agent loop's follow-up calls don't re-fire it).
//
// Isolation is by keyword uniqueness alone — nothing to do with owner, session,
// or turn order. A test's request contains only ITS OWN keys, so it can never
// match another test's registration; an unconsumed entry just sits under its
// keyword and no other request contains it. No shared slot, no per-spec reset.
package main

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// ScriptedTool —— tool call the gateway should emit instead of its default
// search→read behavior. Args is raw JSON forwarded as-is into the SSE
// input_json_delta partial_json field. Key = the test's keyword; the turn whose
// message contains Key consumes this script.
type ScriptedTool struct {
	Name string          `json:"name"`
	Args json.RawMessage `json:"args"`
	Key  string          `json:"key"`
	// Also —— other calls dispatched together with the Name/Args one, **in the same
	// message**. Empty = the old behavior (one call per turn).
	//
	// Why this is needed: a real model dispatches multiple tool_use blocks in one
	// message (agent-loop-robustness measured a turn with four parallel calls in
	// prod), while this mock only ever does one at a time. So **any bug that only
	// shows up on "multiple calls in the same turn" is one no guard can be written
	// for** — F-S-1 (`agent tool done` carries no call identifier, so parallel
	// results can't be attributed) is exactly the item this mock limitation blocked
	// at gate 3. Several items have their backing test marked `gap`, each citing this
	// same mock limitation as the reason.
	//
	// Incidentally: the same tool name can appear more than once
	// (`[{corpus_search,English},{corpus_search,Chinese}]`) — that's exactly the shape
	// F-S-1 needs, so ids must be issued by sequence number, not by name anymore.
	Also []ScriptedToolCall `json:"also,omitempty"`
}

// ScriptedToolCall —— one call within a parallel batch: name + args forwarded as-is.
type ScriptedToolCall struct {
	Name string          `json:"name"`
	Args json.RawMessage `json:"args"`
}

// ScriptedReply —— final text reply to emit (overrides INFERENCE_MOCK_REPLY),
// consumed by a request whose text contains Key.
//
// Stop —— the provider's finish reason for this reply. Empty = "end_turn", the model
// said everything it wanted to. A test registers "max_tokens" to script the OTHER way a
// generation ends: the output budget ran out mid-sentence. That is not an error — the
// stream closes normally — which is exactly why the product could render half a clause
// as a finished answer (F-A-34), and why a guard for it needs the mock to be able to
// produce it.
// DelayMS —— hold the request this long before answering. A real model takes seconds; the
// mock answers instantly, so "a turn is in flight" is a window that does not exist in e2e
// and any guard about it passes on broken code ([[stand-in-is-politer-than-reality]]).
// F-A-42 needs that window: the composer must accept typing WHILE an answer is being written.
type ScriptedReply struct {
	Text    string `json:"text"`
	Key     string `json:"key"`
	Stop    string `json:"stop,omitempty"`
	DelayMS int    `json:"delay_ms"`
}

// scriptedReplyValue —— what the queue stores per key: the text, how it ends, how slow it is.
type scriptedReplyValue struct {
	text    string
	stop    string
	delayMS int
}

// ScriptedGhost —— the GhostPolicy call's JSON body to return, consumed by a
// request containing Key. Raw so a test can queue either an object
// {text,target_waypoint,follows_from,is_bridge} or the literal null (silence).
// No entry for a request → the policy call defaults to null (no ghost).
type ScriptedGhost struct {
	Body json.RawMessage `json:"body"`
	Key  string          `json:"key"`
	// DelayMS —— how long to sleep before serving this ghost call.
	//
	// Why the stand-in needs to be slow (F-A-42): in the real environment, the
	// epilogue's ghost is a real LLM call, measured at 10-26 seconds, while the
	// `done` frame is sent **before** that. That window — "the turn has wrapped up
	// but the stream is still open" — is exactly where the bug lives, and a mock
	// that answers instantly collapses the window to zero -> a guard for it stays
	// green on broken code ([[stand-in-is-politer-than-reality]]). Only affects that
	// one non-streaming GhostPolicy call, doesn't slow down the answer itself.
	DelayMS int `json:"delay_ms"`
}

// ScriptedError —— fail every /v1/messages whose text contains Key with 500,
// simulating a third-party LLM outage. Persists (not single-shot) until a normal
// tool/reply is scripted for the same Key.
type ScriptedError struct {
	Key string `json:"key"`
}

// scriptQueue —— each field a keyword→value registry. Matched by Contains.
// tools is an ORDERED slice (not a map): when a turn's message carries several
// tool keywords, the mock emits them in the order the test registered them —
// deterministic (a test registering corpus_search then corpus_read gets that
// sequence), still pure registration (no guessing which/what order).
type scriptQueue struct {
	mu      sync.Mutex
	tools   []*ScriptedTool
	replies map[string]scriptedReplyValue
	ghosts  map[string]scriptedGhostValue
	fails   map[string]bool
	// rateLimits —— keyword -> `Retry-After` seconds. Once registered, a call whose
	// message contains that keyword gets back **429 + Retry-After**, instead of 500.
	//
	// This is the "proxy that can inject rate-limit responses and retry hints" that
	// agent-loop-robustness's Real dep names explicitly. It had always been treated
	// as an external device, but it's really just these few lines: the mock already
	// injects 500 (`fails`), 429 is just another status code plus a header. Without
	// it, checks 3/4/5 can't reach their pass/fail criterion — and a real provider's
	// rate limiting is the one scenario where "retrying too soon" causes actual harm
	// (a heavier ban).
	rateLimits map[string]int
	// lastKeys —— the `[[s:…]]` tokens from the most recent visitor (stream) turn.
	// Backend-initiated generate calls (GhostPolicy, summarize) are built from
	// derived content and don't carry the visitor message, so the mock retains
	// the turn's keywords here and matches those calls against them. Sequential
	// e2e (workers:1) means a turn's follow-up generate call fires before the
	// next turn, so lastKeys is always the triggering turn's.
	lastKeys string
}

func newScriptQueue() *scriptQueue {
	return &scriptQueue{
		replies:    map[string]scriptedReplyValue{},
		ghosts:     map[string]scriptedGhostValue{},
		fails:      map[string]bool{},
		rateLimits: map[string]int{},
	}
}

// rememberTurnKeys —— retain a visitor (stream) turn's script keywords for the
// follow-up backend generate calls that don't carry them.
func (q *scriptQueue) rememberTurnKeys(tokens string) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.lastKeys = tokens
}

func (q *scriptQueue) retainedKeys() string {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.lastKeys
}

func (q *scriptQueue) setFail(key string) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.fails[key] = true
}

// setRateLimit —— registers "return 429, and ask to wait secs seconds via
// Retry-After" for a keyword.
func (q *scriptQueue) setRateLimit(key string, secs int) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.rateLimits[key] = secs
}

// rateLimitFor —— when the message contains a registered keyword, returns the
// Retry-After seconds it requires; otherwise 0.
func (q *scriptQueue) rateLimitFor(text string) int {
	q.mu.Lock()
	defer q.mu.Unlock()
	for key, secs := range q.rateLimits {
		if strings.Contains(text, key) {
			return secs
		}
	}
	return 0
}

// shouldFailFor —— true if the request text contains any registered fail keyword.
func (q *scriptQueue) shouldFailFor(text string) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	for key := range q.fails {
		if strings.Contains(text, key) {
			return true
		}
	}
	return false
}

// setTool —— register the script for t.Key (append preserves registration order;
// re-registering the same key updates in place). Scripting a normal tool/reply
// for a key clears that key's fail mode (a real reply implies the outage is over).
func (q *scriptQueue) setTool(t *ScriptedTool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	delete(q.fails, t.Key)
	for i := range q.tools {
		if q.tools[i].Key == t.Key {
			q.tools[i] = t
			return
		}
	}
	q.tools = append(q.tools, t)
}

// takeToolFor —— consume the first-registered tool whose keyword the request text
// contains. Single-shot: removed on match so an agent loop's follow-up calls fall
// through to the next registered tool (in order), then the default/final path.
func (q *scriptQueue) takeToolFor(text string) *ScriptedTool {
	q.mu.Lock()
	defer q.mu.Unlock()
	for i := range q.tools {
		if strings.Contains(text, q.tools[i].Key) {
			t := q.tools[i]
			q.tools = append(q.tools[:i], q.tools[i+1:]...)
			return t
		}
	}
	return nil
}

func (q *scriptQueue) setReply(key, text, stop string, delayMS int) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if stop == "" {
		stop = stopEndTurn
	}
	q.replies[key] = scriptedReplyValue{text: text, stop: stop, delayMS: delayMS}
	delete(q.fails, key)
}

// takeReplyFor —— (text, stop reason, found). If registered with a delay, sleeps
// it out before returning (sleeps outside the lock).
func (q *scriptQueue) takeReplyFor(text string) (string, string, bool) {
	r, ok := q.popReply(text)
	if !ok {
		return "", "", false
	}
	if r.delayMS > 0 {
		time.Sleep(time.Duration(r.delayMS) * time.Millisecond)
	}
	return r.text, r.stop, true
}

func (q *scriptQueue) popReply(text string) (scriptedReplyValue, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	for key, r := range q.replies {
		if strings.Contains(text, key) {
			delete(q.replies, key)
			return r, true
		}
	}
	return scriptedReplyValue{}, false
}

// scriptedGhostValue —— one ghost registration: what to return + how long to
// delay first (see ScriptedGhost.DelayMS).
type scriptedGhostValue struct {
	body    string
	delayMS int
}

func (q *scriptQueue) setGhost(key, body string, delayMS int) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.ghosts[key] = scriptedGhostValue{body: body, delayMS: delayMS}
}

// takeGhostFor —— a GhostPolicy call takes the scripted body. If the request
// contains none of the registered ghost keys -> "null" (the silence default), so
// a turn's policy call, when the test isn't about steering, never fires a ghost by
// accident. If registered with a delay, sleeps it out before returning — sleep
// outside the lock, so a slow ghost never stalls the whole gateway.
func (q *scriptQueue) takeGhostFor(text string) string {
	g, ok := q.popGhost(text)
	if !ok {
		return "null"
	}
	if g.delayMS > 0 {
		time.Sleep(time.Duration(g.delayMS) * time.Millisecond)
	}
	return g.body
}

func (q *scriptQueue) popGhost(text string) (scriptedGhostValue, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	for key, g := range q.ghosts {
		if strings.Contains(text, key) {
			delete(q.ghosts, key)
			return g, true
		}
	}
	return scriptedGhostValue{}, false
}

func (s *server) serveSetNextGhost(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	var p ScriptedGhost
	if uerr := json.Unmarshal(body, &p); uerr != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	s.queue.setGhost(p.Key, string(p.Body), p.DelayMS)
	writeJSON(s.log, w, map[string]bool{"ok": true})
}

func (s *server) serveSetNextTool(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	var t ScriptedTool
	if uerr := json.Unmarshal(body, &t); uerr != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	s.queue.setTool(&t)
	writeJSON(s.log, w, map[string]bool{"ok": true})
}

// serveSetNextError —— open "requests containing this key 500" mode, simulating an
// LLM outage. Cleared when a normal reply/tool is scripted for the same key.
func (s *server) serveSetNextError(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	var p ScriptedError
	if uerr := json.Unmarshal(body, &p); uerr != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	s.queue.setFail(p.Key)
	writeJSON(s.log, w, map[string]bool{"ok": true})
}

// ScriptedRateLimit —— {key, retry_after_seconds}。
type ScriptedRateLimit struct {
	Key               string `json:"key"`
	RetryAfterSeconds int    `json:"retry_after_seconds"`
}

// serveSetNextRateLimit —— turns on "return 429 + Retry-After" mode for a keyword.
// The difference from next_error is exactly what this one is testing: 500 means
// "it's broken", 429 means "**don't come back this fast**", and the latter carries
// an interval the provider explicitly stated — retrying too soon makes the ban worse.
func (s *server) serveSetNextRateLimit(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	var p ScriptedRateLimit
	if uerr := json.Unmarshal(body, &p); uerr != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	s.queue.setRateLimit(p.Key, p.RetryAfterSeconds)
	writeJSON(s.log, w, map[string]bool{"ok": true})
}

func (s *server) serveSetNextReply(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	var p ScriptedReply
	if uerr := json.Unmarshal(body, &p); uerr != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	s.queue.setReply(p.Key, p.Text, p.Stop, p.DelayMS)
	writeJSON(s.log, w, map[string]bool{"ok": true})
}

type stateResp struct {
	Tools   []*ScriptedTool          `json:"tools"`
	Replies map[string]stateReplyOut `json:"replies"`
}

// stateReplyOut —— how a queued reply looks in /state. stop is reported
// alongside it: registering "this one ends with max_tokens" but not being able to
// see it is just as hard to debug as not registering it at all.
type stateReplyOut struct {
	Text string `json:"text"`
	Stop string `json:"stop"`
}

func (s *server) serveState(w http.ResponseWriter, _ *http.Request) {
	s.queue.mu.Lock()
	out := make(map[string]stateReplyOut, len(s.queue.replies))
	for k, v := range s.queue.replies {
		out[k] = stateReplyOut{Text: v.text, Stop: v.stop}
	}
	resp := stateResp{Tools: s.queue.tools, Replies: out}
	s.queue.mu.Unlock()
	writeJSON(s.log, w, resp)
}

// serveModels —— an OpenAI-shaped model list (`{"object":"list","data":[{"id":…}]}`).
//
// Two ids rather than one: **with just one, "the list came back" and "the product
// stuffed in its own default" can't be told apart**. The names carry a `mock-`
// prefix, so a guard's assertion is about "what this self-hosted endpoint
// reported", not any real provider's model.
// chatOnlyKey —— **a key that can chat but can't list models** (F-R-12). This kind
// is common in the real world: listing models needs a different permission. The
// trigger is the key itself, not the URL — the criterion is exactly "this key
// can't do it", while the product itself builds `/v1/models`, with no query string
// for the client to pass through.
const chatOnlyKey = "sk-chat-but-cannot-list"

// rateLimitedKey —— **the key that's currently being rate-limited** (F-R-12). Two
// distinct things from the key above: one is "you're not allowed to", the other is
// "not right now" — and the owner's next step is either fixing permissions or
// waiting a minute.
const rateLimitedKey = "sk-rate-limited-right-now"

// serveModels —— the stand-in used to only ever say yes. So "the upstream
// explicitly refused" and "couldn't reach it" collapsed into the same message in
// the product, and nobody could tell (F-R-12). Now it refuses once, the way a real
// provider does.
func (s *server) serveModels(w http.ResponseWriter, r *http.Request) {
	auth := r.Header.Get("Authorization")
	if strings.Contains(auth, chatOnlyKey) {
		w.WriteHeader(http.StatusForbidden)
		writeJSON(s.log, w, map[string]any{
			"error": map[string]any{
				"message": "this key is not permitted to list models",
				"type":    "insufficient_permissions",
			},
		})
		return
	}
	if strings.Contains(auth, rateLimitedKey) {
		w.Header().Set("Retry-After", "30")
		w.WriteHeader(http.StatusTooManyRequests)
		writeJSON(s.log, w, map[string]any{
			"error": map[string]any{"message": "rate limit exceeded", "type": "rate_limit_error"},
		})
		return
	}
	type modelRow struct {
		ID     string `json:"id"`
		Object string `json:"object"`
	}
	writeJSON(s.log, w, map[string]any{
		"object": "list",
		"data": []modelRow{
			{ID: "mock-selfhost-small", Object: "model"},
			{ID: "mock-selfhost-large", Object: "model"},
		},
	})
}

func writeJSON(log interface{ Warn(string, ...any) }, w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Warn("write json", "err", err)
	}
}
