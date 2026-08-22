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
	// Also —— 跟 Name/Args 那次**在同一条消息里**一起派出去的其它调用。空 = 老行为(一轮一个)。
	//
	// 为什么需要它:真模型一条消息里就派多个 tool_use 块(agent-loop-robustness 在 prod 上量到过
	// 一轮四批并行),而这个 mock 只会一次一个。于是**凡是"同一轮里多次调用"才显形的缺陷,守卫都写
	// 不出来** —— F-S-1(`agent tool done` 不带调用标识,并行结果归因不了)就是被这一条挡在 ③ 门外的。
	// 好几个 item 把自己的 backing test 标成 `gap`,理由都写着这同一句 mock 限制。
	//
	// 顺带:同名工具可以出现多次(`[{corpus_search,英文},{corpus_search,中文}]`)—— 那正是 F-S-1
	// 要的形状,所以 id 必须按序号发,不能再按名字发。
	Also []ScriptedToolCall `json:"also,omitempty"`
}

// ScriptedToolCall —— 一条并行调用:名字 + 原样转发的参数。
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
	// DelayMS —— 服务这次 ghost 调用之前先睡多久。
	//
	// 为什么替身需要会慢（F-A-42）：真环境里 epilogue 的 ghost 是一次真的 LLM 调用，实测
	// 10–26 秒，而 `done` 帧在它**之前**就发了。那段「轮已收场、流还开着」的窗口正是缺陷所在，
	// 而 mock 答得飞快 → 窗口塌成 0 → 守卫在坏代码上照样绿（[[stand-in-is-politer-than-reality]]）。
	// 只影响 GhostPolicy 那一次非流式调用，不拖慢答案本身。
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

func (q *scriptQueue) setReply(key, text, stop string, delayMS int) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if stop == "" {
		stop = stopEndTurn
	}
	q.replies[key] = scriptedReplyValue{text: text, stop: stop, delayMS: delayMS}
	delete(q.fails, key)
}

// takeReplyFor —— (text, stop reason, found)。注册带 delay 就先睡够再回(睡在锁外面)。
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

// scriptedGhostValue —— 一次 ghost 注册:回什么 + 回之前先慢多久(见 ScriptedGhost.DelayMS)。
type scriptedGhostValue struct {
	body    string
	delayMS int
}

func (q *scriptQueue) setGhost(key, body string, delayMS int) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.ghosts[key] = scriptedGhostValue{body: body, delayMS: delayMS}
}

// takeGhostFor —— GhostPolicy 调用取脚本化的 body。请求不含任何注册 ghost key →
// "null"(silence 默认),让不测 steering 的 turn 的 policy 调用不会误发 ghost。
// 注册带了 delay 就先睡够再回 —— 睡在锁外面,别让一次慢 ghost 卡住整个网关。
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
	s.queue.setReply(p.Key, p.Text, p.Stop, p.DelayMS)
	writeJSON(s.log, w, map[string]bool{"ok": true})
}

type stateResp struct {
	Tools   []*ScriptedTool          `json:"tools"`
	Replies map[string]stateReplyOut `json:"replies"`
}

// stateReplyOut —— 一条排队中的回复在 /state 里的样子。stop 一起报出来：注册了
// "这条以 max_tokens 收尾" 却看不见，跟没注册一样难查。
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

// serveModels —— OpenAI 形状的模型清单（`{"object":"list","data":[{"id":…}]}`）。
//
// 两个 id 而不是一个：**一个的时候「列表回来了」和「产品自己塞了个默认」分不开**。
// 名字带 `mock-` 前缀，好让守卫断言的是「这台自托管端点报出来的东西」，
// 而不是任何一家真 provider 的型号。
// chatOnlyKey —— **一把能聊、但列不出模型的 key**（F-R-12）。真世界里这一类到处都是：
// 列模型要另一种权限。触发点是 key 本身而不是 URL —— 判据说的就是「这把 key 不行」，
// 而产品自己拼 `/v1/models`，查询串根本传不进来。
const chatOnlyKey = "sk-chat-but-cannot-list"

// rateLimitedKey —— **正被限流的那把 key**（F-R-12）。跟上面那把是两件事：一个是「你不许」，
// 一个是「现在不行」，而 owner 的下一步一个是去改权限、一个是等一分钟。
const rateLimitedKey = "sk-rate-limited-right-now"

// serveModels —— 替身以前只会答应。于是「上游明确拒绝」和「够不着」在产品里塌成同一句话，
// 没人看得出来（F-R-12）。现在它会像真 provider 那样拒绝一次。
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
