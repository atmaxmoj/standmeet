// messages.go —— POST /v1/messages handler.
//
// Decision tree (ported from backend's old mock_single_turn.go):
//
//   1. scripted tool queued by e2e?         → emit tool_use, stop=tool_use
//   2. corpus_search offered + no result?   → emit corpus_search tool_use
//   3. corpus_search ran + corpus_read
//      offered + no read result?            → emit corpus_read tool_use
//   4. skill_*/ext_* tool offered + no
//      result?                              → emit one of them
//   5. else                                  → emit final text reply,
//                                              stop=end_turn
//
// The final text reply prepends "[system:...]\n" + per-message
// "[skill_result:...]\n" echoes so e2e specs verifying system prompt
// assembly + skill/ext tool invocation still see those markers.
package main

import (
	"encoding/json"
	"io"
	"net/http"
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
	// e2e fail-injection:next_error 给某 keyword 打开后,消息里含该 keyword 的
	// inference 调用 500,模拟 LLM 故障(测"失败/重试的 turn 不消耗配额")。
	if s.queue.shouldFailFor(req.markerText()) {
		http.Error(w, `{"error":"mock injected failure"}`, http.StatusInternalServerError)
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
	if scripted, ok := s.queue.takeReplyFor(matchText); ok {
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
		Stop:    "end_turn",
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
	// [[narrate]] —— F-A-4 repro: stream a planning line + a corpus_search every round,
	// never a final reply, so the loop runs to MaxIterations with only narration.
	if hasNarrateMarker(msgText) {
		s.emitNarrateTurn(sse, req)
		return
	}
	if t := s.queue.takeToolFor(msgText); t != nil {
		s.emitToolUseTurn(sse, t.Name, t.Args)
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

// narrateLines —— the planning preambles the mock streams each round. Concatenated
// across MaxIterations rounds they are exactly the "Let me survey… Let me dig into…"
// non-answer F-A-4 flagged.
var narrateLines = []string{
	"Let me survey the corpus for that.",
	"Let me dig into the specifics.",
	"Let me cross-check another angle.",
	"Let me look at one more note.",
}

// emitNarrateTurn —— stream a planning line (index 0) then a corpus_search tool_use
// (index 1), stop=tool_use. Never emits a final reply, so the agent loops until it
// exhausts MaxIterations — with the planning narration accumulated as its only text.
func (s *server) emitNarrateTurn(sse *sseWriter, req *MessagesReq) {
	round := countToolResultBlocks(req)
	line := narrateLines[round%len(narrateLines)]
	if err := emitTextBlock(sse, 0, line); err != nil {
		s.log.Warn("emit narrate text", "err", err)
		return
	}
	if err := emitToolUseBlock(sse, 1, "toolu_narrate", "corpus_search",
		json.RawMessage(`{"query":"design"}`)); err != nil {
		s.log.Warn("emit narrate tool_use", "err", err)
		return
	}
	if err := emitMessageDelta(sse, "tool_use"); err != nil {
		s.log.Warn("emit narrate message_delta", "err", err)
		return
	}
	if err := emitMessageStop(sse); err != nil {
		s.log.Warn("emit narrate message_stop", "err", err)
	}
}

// countToolResultBlocks —— how many tool_result blocks are already in the history
// (i.e. which narrate round we're on), so successive rounds vary their planning line.
func countToolResultBlocks(req *MessagesReq) int {
	n := 0
	for i := range req.Messages {
		for j := range req.Messages[i].Content {
			if req.Messages[i].Content[j].Type == "tool_result" {
				n++
			}
		}
	}
	return n
}

func (s *server) emitToolUseTurn(
	sse *sseWriter, name string, input json.RawMessage,
) {
	id := "toolu_mock_" + name
	if len(input) == 0 {
		input = json.RawMessage(`{}`)
	}
	if err := emitToolUseBlock(sse, 0, id, name, input); err != nil {
		s.log.Warn("emit tool_use", "err", err)
		return
	}
	if err := emitMessageDelta(sse, "tool_use"); err != nil {
		s.log.Warn("emit message_delta", "err", err)
		return
	}
	if err := emitMessageStop(sse); err != nil {
		s.log.Warn("emit message_stop", "err", err)
	}
}

func (s *server) emitFinalReply(sse *sseWriter, req *MessagesReq) {
	text := s.reply
	if scripted, ok := s.queue.takeReplyFor(req.markerText()); ok {
		text = scripted
	}
	text = composeFinalReply(req, text)
	if err := emitTextBlock(sse, 0, text); err != nil {
		s.log.Warn("emit text", "err", err)
		return
	}
	if err := emitMessageDelta(sse, "end_turn"); err != nil {
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
