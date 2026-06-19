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

const (
	toolCorpusSearch = "corpus_search"
	toolCorpusRead   = "corpus_read"
)

func (s *server) serveMessages(w http.ResponseWriter, r *http.Request) {
	// e2e fail-injection:next_error 打开后所有 inference 调用 500,模拟 LLM 故障
	// (测"失败/重试的 turn 不消耗配额")。
	if s.queue.shouldFail() {
		http.Error(w, `{"error":"mock injected failure"}`, http.StatusInternalServerError)
		return
	}
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

// serveNonStream —— /v1/messages stream=false. Anthropic returns one
// JSON envelope: {content: [block...], stop_reason: ...}. Visitor
// summary / follow-up 生成走这条(no tools, no agent loop)。
func (s *server) serveNonStream(w http.ResponseWriter, req *MessagesReq) {
	if isFollowupGen(req) {
		s.writeNonStream(w, req.Model, followupGhosts)
		return
	}
	text := s.reply
	if scripted, ok := s.queue.takeReply(); ok {
		text = scripted
	}
	text = composeFinalReply(req, text)
	s.writeNonStream(w, req.Model, text)
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

func (s *server) dispatch(sse *sseWriter, req *MessagesReq) {
	if t := s.queue.takeTool(); t != nil {
		s.emitToolUseTurn(sse, t.Name, t.Args)
		return
	}
	// [[think:N]] —— 跳过 tool,sleep 后直接出答案。期间没 tool 在跑,前端显
	// thinking 词库轮换那条(测 #10)。
	if d := markerDelay(req.markerText(), "think"); d > 0 {
		time.Sleep(d)
		s.emitFinalReply(sse, req)
		return
	}
	if call := nextCorpusCall(req); call != nil {
		s.emitToolUseTurn(sse, call.Name, call.Input)
		return
	}
	if call := nextSkillOrExtCall(req); call != nil {
		s.emitToolUseTurn(sse, call.Name, call.Input)
		return
	}
	s.emitFinalReply(sse, req)
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
	if scripted, ok := s.queue.takeReply(); ok {
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

// toolCall —— minimal carrier for the dispatch decision.
type toolCall struct {
	Name  string
	Input json.RawMessage
}

func nextCorpusCall(req *MessagesReq) *toolCall {
	if !req.hasTool(toolCorpusSearch) {
		return nil
	}
	if !req.hasToolResult(toolCorpusSearch) {
		return makeSearchCall(req)
	}
	if req.hasTool(toolCorpusRead) && !req.hasToolResult(toolCorpusRead) {
		return makeReadCall(req)
	}
	return nil
}

func makeSearchCall(req *MessagesReq) *toolCall {
	// 剥掉延时 marker,别让它进真 corpus_search 的 query 干扰命中。
	args, err := json.Marshal(map[string]string{"query": stripMarkers(req.lastUserText())})
	if err != nil {
		return nil
	}
	return &toolCall{Name: toolCorpusSearch, Input: args}
}

func makeReadCall(req *MessagesReq) *toolCall {
	path := req.firstPathFromSearchResult()
	if path == "" {
		return nil
	}
	args, err := json.Marshal(map[string]string{"path": path})
	if err != nil {
		return nil
	}
	return &toolCall{Name: toolCorpusRead, Input: args}
}

func nextSkillOrExtCall(req *MessagesReq) *toolCall {
	for i := range req.Tools {
		name := req.Tools[i].Name
		if !isSkillOrExt(name) || isGenericSkillTool(name) {
			continue
		}
		if req.hasToolResult(name) {
			continue
		}
		return &toolCall{Name: name, Input: json.RawMessage(`{}`)}
	}
	return nil
}

func isSkillOrExt(name string) bool {
	return strings.HasPrefix(name, "skill_") || strings.HasPrefix(name, "ext_")
}

// isGenericSkillTool —— Phase C 的两个通用 skill 工具(skill_use / skill_run_script)
// 需要 {name,script,...} 入参,自然路径的空 {} 喂不了 → 不自动调,只能 e2e 用
// scriptMockToolCall 显式驱动。仍参与 [skill_result:...] echo(isSkillOrExt 不变)。
func isGenericSkillTool(name string) bool {
	return name == "skill_use" || name == "skill_run_script"
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
			if b.Type == "tool_use" && isSkillOrExt(b.Name) && b.ID != "" {
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
