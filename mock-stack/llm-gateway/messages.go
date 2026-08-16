// messages.go —— POST /v1/messages handler.
//
// Decision tree (ported from backend's old mock_single_turn.go):
//
//  1. scripted tool queued by e2e?         → emit tool_use, stop=tool_use
//  2. corpus_search offered + no result?   → emit corpus_search tool_use
//  3. corpus_search ran + corpus_read
//     offered + no read result?            → emit corpus_read tool_use
//  4. skill_*/ext_* tool offered + no
//     result?                              → emit one of them
//  5. else                                  → emit final text reply,
//     stop=end_turn
//
// The final text reply prepends "[system:...]\n" + per-message
// "[skill_result:...]\n" echoes so e2e specs verifying system prompt
// assembly + skill/ext tool invocation still see those markers.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// toolCorpusRead —— serveStream 的 [[slow-final:N]] marker 只在 corpus_read
// 已有结果(出最终答案那一调)时生效,用它认。
const toolCorpusRead = "corpus_read"

func (s *server) serveMessages(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	var req MessagesReq
	if uerr := json.Unmarshal(body, &req); uerr != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	// 先记账再分派 —— 注入的失败也要记:"这一轮打到了哪个 provider" 跟这一轮成没成功
	// 是两件事(测 provider 挂了怎么退默认时,要断言的正是那趟失败请求的去向)。
	s.rec.record(recordFrom(r, &req), req.markerText())
	// e2e fail-injection:next_error 给某 keyword 打开后,消息里含该 keyword 的
	// inference 调用 500,模拟 LLM 故障(测"失败/重试的 turn 不消耗配额")。
	if s.queue.shouldFailFor(req.markerText()) {
		http.Error(w, `{"error":"mock injected failure"}`, http.StatusInternalServerError)
		return
	}
	// e2e rate-limit injection:next_rate_limit 注册之后,含该 keyword 的调用回 **429 +
	// Retry-After**。这是 agent-loop-robustness 的 Real dep 点名的那个「能注入限流响应和
	// 重试提示」的东西 —— 一直被我当成外部装置,其实就是这几行。
	if secs := s.queue.rateLimitFor(req.markerText()); secs > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(secs))
		http.Error(w, `{"error":"mock injected rate limit"}`, http.StatusTooManyRequests)
		return
	}
	if !req.Stream {
		s.serveNonStream(w, &req)
		return
	}
	s.serveStream(w, &req)
}

func (s *server) serveStream(w http.ResponseWriter, req *MessagesReq) {
	sse, serr := newSSE(w)
	if serr != nil {
		http.Error(w, serr.Error(), http.StatusInternalServerError)
		return
	}
	// [[slow-final:N]] —— corpus_read 已跑完 → 这是出最终答案的调用。sleep 放在
	// message_start **之前**:这一调用一旦开始发帧,前端就把 read throbber 顶成
	// 答案流了;趁还没发任何帧时 hold N ms,read throbber("reading X")才在 DOM
	// 上停得住能断言(测 #9)。
	if d := markerDelay(req.markerText(), "slow-final"); d > 0 && req.hasToolResult(toolCorpusRead) {
		time.Sleep(d)
	}
	if werr := emitMessageStart(sse, req.Model); werr != nil {
		s.log.Warn("emit message_start", "err", werr)
		return
	}
	s.dispatch(sse, req)
}

// followupGhosts —— turn 收尾的 follow-up 生成调用(非流式,system 是
// followupGenPrompt)固定回这 3 条,让 e2e 里 SSE `ghosts` 帧有内容、能测
// "答完后输入框 ghost 推进到 followup"。跟 seed 问题不同,便于断言。
const followupGhosts = `["What got you into this work?",` +
	`"How do you handle on-call?","What are you building next?"]`

// isFollowupGen —— 这次非流式调用是不是 follow-up 生成(按 followupGenPrompt
// 里独有的 "JSON array of 3 strings" 认)。
func isFollowupGen(req *MessagesReq) bool {
	return strings.Contains(req.System.Text, "JSON array of 3 strings")
}

// isGhostPolicy —— 这次非流式调用是不是 GhostPolicy(单个 steering ghost 生成,按其
// prompt 独有的 "ONE GHOST MESSAGE" 认)。回 takeGhost():脚本化 body 或默认 null(silence)。
func isGhostPolicy(req *MessagesReq) bool {
	return strings.Contains(req.System.Text, "ONE GHOST MESSAGE")
}

// serveNonStream —— /v1/messages stream=false. Anthropic returns one
// JSON envelope: {content: [block...], stop_reason: ...}. Visitor
// summary / follow-up / ghost-policy 生成走这条(no tools, no agent loop)。
func (s *server) serveNonStream(w http.ResponseWriter, req *MessagesReq) {
	// Backend-initiated generate calls (GhostPolicy / summarize) are built from
	// derived content and don't carry the visitor message's keyword, so also match
	// against the retained keywords of the turn that triggered this call.
	matchText := req.markerText() + " " + s.queue.retainedKeys()
	if isGhostPolicy(req) {
		s.writeNonStream(w, req.Model, s.queue.takeGhostFor(matchText))
		return
	}
	if isFollowupGen(req) {
		s.writeNonStream(w, req.Model, followupGhosts)
		return
	}
	text := s.reply
	// 非流式那条路只用正文；stop 是流式收尾的事（见 emitFinalReply）。
	if scripted, _, ok := s.queue.takeReplyFor(matchText); ok {
		text = scripted
	}
	// summarize report generation returns the report HTML RAW (like a real LLM) — no [system:...]
	// echo. The echo (composeFinalReply) is for chat replies where tests assert prompt assembly;
	// prepending it to a report pollutes the stored HTML (and breaks HTML sanitization on it).
	if !isSummarizeGen(req) {
		text = composeFinalReply(req, text)
	}
	s.writeNonStream(w, req.Model, text)
}

// isSummarizeGen —— the non-stream call that generates a conversation report (its system is the
// summarize component-kit prompt). Detected by a phrase unique to summarizeHTMLPrompt.
func isSummarizeGen(req *MessagesReq) bool {
	return strings.Contains(req.System.Text, "report component kit")
}

func (s *server) writeNonStream(w http.ResponseWriter, model, text string) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(nonStreamMessage{
		ID:      "msg_mock_1",
		Type:    "message",
		Role:    "assistant",
		Model:   model,
		Content: []map[string]string{{"type": "text", "text": text}},
		Stop:    stopEndTurn,
		Usage:   map[string]int{"input_tokens": 1, "output_tokens": 1},
	}); err != nil {
		s.log.Warn("encode non-stream message", "err", err)
	}
}

type nonStreamMessage struct {
	ID      string              `json:"id"`
	Type    string              `json:"type"`
	Role    string              `json:"role"`
	Model   string              `json:"model"`
	Content []map[string]string `json:"content"`
	Stop    string              `json:"stop_reason"`
	Usage   map[string]int      `json:"usage"`
}

// dispatch —— 纯注册:只发**测试注册过**的工具(takeToolFor 按消息里的 keyword
// 命中),否则出最终答复。mock 不再替 LLM"猜"该搜什么 / 该调哪个工具 —— 想让 agent
// 调 corpus_search / corpus_read / skill_ / ext_,测试自己注册(scriptMockToolCall)。
// think marker 只是 turn 内时序,不是猜。
func (s *server) dispatch(sse *sseWriter, req *MessagesReq) {
	msgText := req.markerText()
	// Retain this visitor turn's keywords so its follow-up backend generate calls
	// (GhostPolicy / summarize), which don't carry the visitor message, still match
	// this turn's registrations.
	s.queue.rememberTurnKeys(scriptKeyTokens(msgText))
	if t := s.queue.takeToolFor(msgText); t != nil {
		s.emitToolUseTurnN(sse, scriptedCallsOf(t))
		return
	}
	// [[think:N]] —— 跳过 tool,sleep 后直接出答案。期间没 tool 在跑,前端显
	// thinking 词库轮换那条(测 #10)。
	if d := markerDelay(msgText, "think"); d > 0 {
		time.Sleep(d)
		s.emitFinalReply(sse, req)
		return
	}
	s.emitFinalReply(sse, req)
}

// scriptedCallsOf —— 一条注册摊平成这一轮要派的调用序列:主调用在前,Also 依次跟上。
func scriptedCallsOf(t *ScriptedTool) []ScriptedToolCall {
	out := make([]ScriptedToolCall, 0, 1+len(t.Also))
	out = append(out, ScriptedToolCall{Name: t.Name, Args: t.Args})
	return append(out, t.Also...)
}

// emitToolUseTurnN —— 一条消息里派 N 个 tool_use 块,再收 `stop=tool_use`。N=1 就是老行为。
//
// **id 按序号,不按名字。** 老写法是 `toolu_mock_<name>`,同名工具在一轮里出现两次就撞成同一个 id,
// 而"同名多次"恰好是这条能力最要紧的用途(F-S-1)。撞了不会报错,只会让两次调用在下游看起来是一次
// —— 一个静默地把被测形状抹平的 bug。
func (s *server) emitToolUseTurnN(sse *sseWriter, calls []ScriptedToolCall) {
	for i := range calls {
		input := calls[i].Args
		if len(input) == 0 {
			input = json.RawMessage(`{}`)
		}
		id := fmt.Sprintf("toolu_mock_%d_%s", i, calls[i].Name)
		if err := emitToolUseBlock(sse, i, id, calls[i].Name, input); err != nil {
			s.log.Warn("emit tool_use", "err", err, "index", i)
			return
		}
	}
	if err := emitMessageDelta(sse, stopToolUse); err != nil {
		s.log.Warn("emit message_delta", "err", err)
		return
	}
	if err := emitMessageStop(sse); err != nil {
		s.log.Warn("emit message_stop", "err", err)
	}
}

func (s *server) emitFinalReply(sse *sseWriter, req *MessagesReq) {
	text, stop := s.reply, stopEndTurn
	if scripted, scriptedStop, ok := s.queue.takeReplyFor(req.markerText()); ok {
		text, stop = scripted, scriptedStop
	}
	// **空正文 + max_tokens 是真厂商做得出来的事**：预算全花在工具调用上时，
	// Anthropic 关流时一个 text block 都不发（prod 上量到过：`stop=max_tokens
	// answer_chars=0`，51 次检索之后访客一个字没拿到 —— F-A-40）。
	// 这里以前无条件走 composeFinalReply，于是**这个 mock 比真厂商客气**：哪怕脚本
	// 写的是空串，它也会回一大段 `[system:…]` 回声，那条路上的边界因此永远测不出来
	// （[[stand-in-is-politer-than-reality]]）。规则收窄成「脚本明确要空正文 + 预算
	// 用完」这一种，别的调用照旧带回声。
	if text == "" && stop == stopMaxTokens {
		s.emitEmptyBudgetStop(sse)
		return
	}
	text = composeFinalReply(req, text)
	if err := emitTextBlock(sse, 0, text); err != nil {
		s.log.Warn("emit text", "err", err)
		return
	}
	if err := emitMessageDelta(sse, stop); err != nil {
		s.log.Warn("emit message_delta", "err", err)
		return
	}
	if err := emitMessageStop(sse); err != nil {
		s.log.Warn("emit message_stop", "err", err)
	}
}

// emitEmptyBudgetStop —— 收流,但一个 text block 都不发。见 emitFinalReply 里的注释:
// 这是真厂商在「预算全花在工具调用上」时的收场形状。
func (s *server) emitEmptyBudgetStop(sse *sseWriter) {
	if err := emitMessageDelta(sse, stopMaxTokens); err != nil {
		s.log.Warn("emit message_delta", "err", err)
		return
	}
	if err := emitMessageStop(sse); err != nil {
		s.log.Warn("emit message_stop", "err", err)
	}
}

// echoToolPrefixes —— 「工具结果要 echo 进 mock 回复（[skill_result:...]）」的工具名
// 前缀**注册表**。要支持新东西（又一个沙箱插件、归一后的内建能力）就往这里**注册一个
// 前缀**。
//
// 为什么要 echo 这些：沙箱 / FS / 网络「关押」的 e2e 断言要能区分「真读到 vs 被拒」，
// 而 mock 回复是写死的；把真实工具结果反射进回复，断言才不是空断言。
var echoToolPrefixes = []string{
	"skill_", "ext_", // Phase C skills + 第三方 ext-mcp
	"everything_", "fsmcp_", "netfetch_", "cagedfetch_", "escapee_", // e2e 真第三方沙箱插件
}

// shouldEchoResult —— 该工具结果是否 echo 进 mock 回复（[skill_result:...]）。用宽的
// echoToolPrefixes 注册表（含沙箱插件前缀），让沙箱/FS/网络关押断言能区分真读到 vs 被拒。
func shouldEchoResult(name string) bool {
	for _, p := range echoToolPrefixes {
		if strings.HasPrefix(name, p) {
			return true
		}
	}
	return false
}

// composeFinalReply —— echo system prompt + every skill_result body the
// assistant has seen, then append the base reply text. Matches what the
// old MockProvider emitted so e2e assertions on "[system:...]" /
// "[skill_result:...]" markers still pass.
//
// Markers are separated from the base reply by a blank line so markdown
// in `base` (headings, fenced code, tables) parses standalone — a single
// `\n` would glue the next line into the previous para and break things
// like `# Heading` (commonmark needs the heading at block start).
func composeFinalReply(req *MessagesReq, base string) string {
	var b strings.Builder
	if req.System.Text != "" {
		b.WriteString("[system:")
		b.WriteString(req.System.Text)
		b.WriteString("]\n\n")
	}
	collectSkillEchoes(req, &b)
	b.WriteString(base)
	return b.String()
}

// collectSkillEchoes —— walk Anthropic-shape messages, for every
// tool_result block whose paired tool_use is skill_*/ext_*, echo
// "[skill_result:<body>]\n\n". Matches the original mock_single_turn
// behavior so e2e assertions on system prompt assembly + skill/ext
// tool execution still surface.
func collectSkillEchoes(req *MessagesReq, out *strings.Builder) {
	skillIDs := skillExtToolUseIDs(req.Messages)
	for i := range req.Messages {
		m := &req.Messages[i]
		if m.Role != "user" {
			continue
		}
		for j := range m.Content {
			echoSkillResultBlock(&m.Content[j], skillIDs, out)
		}
	}
}

func skillExtToolUseIDs(msgs []Msg) map[string]bool {
	out := map[string]bool{}
	for i := range msgs {
		if msgs[i].Role != "assistant" {
			continue
		}
		for j := range msgs[i].Content {
			b := &msgs[i].Content[j]
			if b.Type == "tool_use" && shouldEchoResult(b.Name) && b.ID != "" {
				out[b.ID] = true
			}
		}
	}
	return out
}

func echoSkillResultBlock(b *Block, ids map[string]bool, out *strings.Builder) {
	if b.Type != "tool_result" || !ids[b.ToolUseID] {
		return
	}
	body := unwrapResultJSONRaw(b.Content)
	out.WriteString("[skill_result:")
	out.WriteString(body)
	out.WriteString("]\n\n")
}

// unwrapResultJSONRaw —— tool_result.content 跨 wire 形态拆出来：可能是
// JSON-encoded string，也可能是 anthropic-sdk-go 的 content-block array
// 形式。走 wire.go unwrapToolResultContent 统一处理。
func unwrapResultJSONRaw(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	return unwrapResultJSON(string(unwrapToolResultContent(raw)))
}

// unwrapResultJSON —— if body is {"ok":true,"result":<x>}, return <x>;
// else return body as-is.
func unwrapResultJSON(raw string) string {
	raw = strings.TrimSpace(raw)
	var wrap struct {
		Result json.RawMessage `json:"result"`
	}
	if err := json.Unmarshal([]byte(raw), &wrap); err == nil && len(wrap.Result) > 0 {
		return string(wrap.Result)
	}
	return raw
}
