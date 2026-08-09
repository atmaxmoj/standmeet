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
)

// ScriptedTool —— tool call the gateway should emit instead of its default
// search→read behavior. Args is raw JSON forwarded as-is into the SSE
// input_json_delta partial_json field. Key = the test's keyword; the turn whose
// message contains Key consumes this script.
type ScriptedTool struct {
	Name string          `json:"name"`
	Args json.RawMessage `json:"args"`
	Key  string          `json:"key"`
}

// ScriptedReply —— final text reply to emit (overrides INFERENCE_MOCK_REPLY),
// consumed by a request whose text contains Key.
type ScriptedReply struct {
	Text string `json:"text"`
	Key  string `json:"key"`
}

// ScriptedGhost —— the GhostPolicy call's JSON body to return, consumed by a
// request containing Key. Raw so a test can queue either an object
// {text,target_waypoint,follows_from,is_bridge} or the literal null (silence).
// No entry for a request → the policy call defaults to null (no ghost).
type ScriptedGhost struct {
	Body json.RawMessage `json:"body"`
	Key  string          `json:"key"`
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
	replies map[string]string
	ghosts  map[string]string
	fails   map[string]bool
	// rateLimits —— keyword → `Retry-After` 秒数。注册之后,消息里含该 keyword 的调用回
	// **429 + Retry-After**,而不是 500。
	//
	// 这是 agent-loop-robustness 的 Real dep 点名的那个「能注入限流响应和重试提示的代理」。
	// 它一直被当成外部装置,其实就是这里的几行:mock 已经会注入 500(`fails`),429 只是另一种
	// 状态码加一个头。没有它,checks 3/4/5 在判据上够不着 —— 而真实 provider 的限流是唯一
	// 会让「提前重打」造成实际伤害(加重封禁)的场景。
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
		replies:    map[string]string{},
		ghosts:     map[string]string{},
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

// setRateLimit —— 给某 keyword 注册「回 429,并在 Retry-After 里要求等 secs 秒」。
func (q *scriptQueue) setRateLimit(key string, secs int) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.rateLimits[key] = secs
}

// rateLimitFor —— 消息里含已注册的 keyword 时,返回它要求的 Retry-After 秒数;否则 0。
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

func (q *scriptQueue) setReply(key, text string) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.replies[key] = text
	delete(q.fails, key)
}

func (q *scriptQueue) takeReplyFor(text string) (string, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	for key, r := range q.replies {
		if strings.Contains(text, key) {
			delete(q.replies, key)
			return r, true
		}
	}
	return "", false
}

func (q *scriptQueue) setGhost(key, body string) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.ghosts[key] = body
}

// takeGhostFor —— GhostPolicy 调用取脚本化的 body。请求不含任何注册 ghost key →
// "null"(silence 默认),让不测 steering 的 turn 的 policy 调用不会误发 ghost。
func (q *scriptQueue) takeGhostFor(text string) string {
	q.mu.Lock()
	defer q.mu.Unlock()
	for key, g := range q.ghosts {
		if strings.Contains(text, key) {
			delete(q.ghosts, key)
			return g
		}
	}
	return "null"
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
	s.queue.setGhost(p.Key, string(p.Body))
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

// serveSetNextRateLimit —— 给某 keyword 打开「回 429 + Retry-After」模式。
// 跟 next_error 的区别正是这一条要测的东西:500 是"坏了",429 是"**别这么快再来**",
// 而后者带着一个 provider 明说的间隔 —— 提前重打会加重封禁。
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
	s.queue.setReply(p.Key, p.Text)
	writeJSON(s.log, w, map[string]bool{"ok": true})
}

type stateResp struct {
	Tools   []*ScriptedTool   `json:"tools"`
	Replies map[string]string `json:"replies"`
}

func (s *server) serveState(w http.ResponseWriter, _ *http.Request) {
	s.queue.mu.Lock()
	resp := stateResp{Tools: s.queue.tools, Replies: s.queue.replies}
	s.queue.mu.Unlock()
	writeJSON(s.log, w, resp)
}

func writeJSON(log interface{ Warn(string, ...any) }, w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Warn("write json", "err", err)
	}
}
