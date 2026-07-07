// script.go —— admin queue + handlers for e2e scripting.
//
// Single-slot queues for next_tool and next_reply; later writes overwrite
// pending unread values. Tests typically script one then drive one visitor
// chat turn before scripting again.
package main

import (
	"encoding/json"
	"io"
	"net/http"
	"sync"
)

// ScriptedTool —— tool call the gateway should emit next instead of its
// default search→read behavior. Args is raw JSON forwarded as-is into the
// SSE input_json_delta partial_json field.
//
// Key —— keyed registration: only the turn carrying a matching [[s:Key]] token
// in its message consumes this script. "" = wildcard (any turn whose message
// has no token). Keying isolates concurrent scripts so a trailing/other turn
// can't steal a script meant for a specific (test, turn) — the global
// single-slot theft that flaked visitor-ask-visitor.
type ScriptedTool struct {
	Name string          `json:"name"`
	Args json.RawMessage `json:"args"`
	Key  string          `json:"key"`
}

// ScriptedReply —— final text reply to emit (overrides INFERENCE_MOCK_REPLY).
type ScriptedReply struct {
	Text string `json:"text"`
}

// ScriptedGhost —— the GhostPolicy call's JSON body to return next. Raw so a test
// can queue either an object {text,target_waypoint,follows_from,is_bridge} or the
// literal null (silence). Unset → the policy call defaults to null (no ghost), so
// turns not exercising steering never spuriously emit a ghost frame.
type ScriptedGhost struct {
	Body json.RawMessage `json:"body"`
}

type scriptQueue struct {
	mu sync.Mutex
	// tools —— keyed by WhenUser ("" = wildcard). A keyed registry instead of
	// a single slot so concurrent scripts (overlapping turns across tests)
	// don't steal each other.
	tools map[string]*ScriptedTool
	reply *string
	ghost *string
	// failAll —— e2e 用 next_error 打开后,所有 /v1/messages 返 500,模拟第三方
	// LLM 故障(测"失败的 turn 不消耗配额")。scripting 正常 tool/reply 会清掉它。
	failAll bool
}

func newScriptQueue() *scriptQueue {
	return &scriptQueue{tools: map[string]*ScriptedTool{}}
}

func (q *scriptQueue) setFailAll(v bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.failAll = v
}

func (q *scriptQueue) shouldFail() bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.failAll
}

func (q *scriptQueue) setTool(t *ScriptedTool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.tools[t.Key] = t
	q.failAll = false
}

// takeToolFor —— consume the script registered for this turn's [[s:KEY]] token.
// Exact key match wins; a turn with no token (key="") falls back to the
// wildcard slot. The matched entry is removed (single-shot per registration).
func (q *scriptQueue) takeToolFor(key string) *ScriptedTool {
	q.mu.Lock()
	defer q.mu.Unlock()
	if key != "" {
		if t, ok := q.tools[key]; ok {
			delete(q.tools, key)
			return t
		}
	}
	if t, ok := q.tools[""]; ok {
		delete(q.tools, "")
		return t
	}
	return nil
}

func (q *scriptQueue) setReply(text string) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.reply = &text
	q.failAll = false
}

func (q *scriptQueue) takeReply() (string, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.reply == nil {
		return "", false
	}
	out := *q.reply
	q.reply = nil
	return out, true
}

func (q *scriptQueue) setGhost(body string) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.ghost = &body
}

// takeGhost —— GhostPolicy 调用取脚本化的 body。未脚本化 → "null"(silence 默认),
// 让不测 steering 的 turn 的 policy 调用不会误发 ghost。single-shot。
func (q *scriptQueue) takeGhost() string {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.ghost == nil {
		return "null"
	}
	out := *q.ghost
	q.ghost = nil
	return out
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
	s.queue.setGhost(string(p.Body))
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

// serveSetNextError —— e2e 打开"所有 inference 调用都 500"模式,模拟 LLM 故障。
// 下一次 scripting 正常 reply/tool 会自动清掉。
func (s *server) serveSetNextError(w http.ResponseWriter, _ *http.Request) {
	s.queue.setFailAll(true)
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
	s.queue.setReply(p.Text)
	writeJSON(s.log, w, map[string]bool{"ok": true})
}

type stateResp struct {
	Tools map[string]*ScriptedTool `json:"tools"`
	Reply *string                  `json:"reply"`
}

func (s *server) serveState(w http.ResponseWriter, _ *http.Request) {
	s.queue.mu.Lock()
	resp := stateResp{Tools: s.queue.tools, Reply: s.queue.reply}
	s.queue.mu.Unlock()
	writeJSON(s.log, w, resp)
}

func writeJSON(log interface{ Warn(string, ...any) }, w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Warn("write json", "err", err)
	}
}
