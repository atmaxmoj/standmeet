// mock_single_turn.go —— Phase D: StreamSingleTurn for MockProvider。
//
// Browser pi-agent-core 跑 agent loop 时每轮调一次 /inference/stream;
// mock 这边按 messages 历史决定本轮做啥：
//   - 没 tool_result + tools 含 corpus_search → 调 corpus_search
//   - 有 search tool_result 没 read tool_result → 调 corpus_read
//   - 都有了 / 没 tool / 其他 → 流 reply 文本 + done(end_turn)
//
// 跟老的 maybeRunMockToolLoop 行为对齐，但拆成"按 messages 决定下一步"
// 的形态让 caller (browser) 驱动 loop 而非 mock 自己 loop。

package inference

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
)

const mockSingleTurnChanBuf = 32

// StreamSingleTurn —— provider interface 的新方法实现。
func (m *MockProvider) StreamSingleTurn(
	ctx context.Context, req *ChatRequest,
) (<-chan StreamEvent, error) {
	ch := make(chan StreamEvent, mockSingleTurnChanBuf)
	go m.runSingleTurnMock(ctx, req, ch)
	return ch, nil
}

func (m *MockProvider) runSingleTurnMock(
	ctx context.Context, req *ChatRequest, ch chan<- StreamEvent,
) {
	defer close(ch)
	if call := nextScriptedToolCall(ctx, m); call != nil {
		emitToolCallAndDone(ctx, ch, call)
		return
	}
	if call := nextCorpusToolCall(req); call != nil {
		emitToolCallAndDone(ctx, ch, call)
		return
	}
	if call := nextSkillOrExtToolCall(req); call != nil {
		emitToolCallAndDone(ctx, ch, call)
		return
	}
	emitTextReplyAndDone(ctx, ch, composeMockFinalText(req, m.reply))
}

// nextSkillOrExtToolCall —— mock 顺手调一个 skill_* / ext_* tool 让 e2e
// 验证 sandbox 真跑 + 外部 MCP 真连。tools 含 skill_*/ext_* 但 messages
// 无 tool_result → 调一次。
func nextSkillOrExtToolCall(req *ChatRequest) *StreamToolCall {
	for i := range req.Tools {
		name := req.Tools[i].Name
		if isSkillOrExtName(name) && !hasToolResult(req.Messages, name) {
			return &StreamToolCall{
				ID: "mock-" + name + "-1", Name: name, Input: []byte(`{}`),
			}
		}
	}
	return nil
}

func isSkillOrExtName(name string) bool {
	return hasPrefix(name, "skill_") || hasPrefix(name, "ext_")
}

func hasPrefix(s, prefix string) bool {
	return len(s) >= len(prefix) && s[:len(prefix)] == prefix
}

// composeMockFinalText —— echo 系统 prompt + 各 tool_result 内容进 reply
// (跟老 mock 的 "[system:...] [skill_result:...] <reply>" 输出形态对齐)，
// 让既有 e2e 验 system prompt 装配 + skill/ext tool 真跑能继续过。
func composeMockFinalText(req *ChatRequest, baseReply string) string {
	var b strings.Builder
	if req.System != "" {
		writeAll(&b, "[system:", req.System, "]\n")
	}
	for i := range req.Messages {
		writeAll(&b, extractSkillExtResults(req.Messages[i].Content))
	}
	writeAll(&b, baseReply)
	return b.String()
}

// writeAll —— strings.Builder.WriteString 严格 lint 要求 handle return；
// helper 一次性吃掉所有 (string, int, error) 让 caller cyclo 不爆。
func writeAll(b *strings.Builder, parts ...string) {
	for _, p := range parts {
		_, _ = b.WriteString(p)
	}
}

// extractSkillExtResults —— 从 assistant message content (含
// "[tool_result:NAME] {json}") 抽出 skill_*/ext_* 工具的 result body，
// 包成 "[skill_result:<body>]\n" 形式 (跟老 mock echo 同形态)。
func extractSkillExtResults(content string) string {
	var out strings.Builder
	rest := content
	for rest != "" {
		next, more := extractOneSkillExt(rest, &out)
		rest = next
		if !more {
			break
		}
	}
	return out.String()
}

// extractOneSkillExt —— 解一个 [tool_result:NAME] 块；写入 out (skill/ext
// 名才写)；返 (剩余 rest, 是否继续找)。
func extractOneSkillExt(rest string, out *strings.Builder) (string, bool) {
	idx := strings.Index(rest, "[tool_result:")
	if idx < 0 {
		return "", false
	}
	nameEnd := strings.Index(rest[idx:], "]")
	if nameEnd < 0 {
		return "", false
	}
	nameStart := idx + len("[tool_result:")
	name := rest[nameStart : idx+nameEnd]
	sl := sliceToolResultBody(rest[idx+nameEnd+1:])
	if isSkillOrExtName(name) {
		writeAll(out, "[skill_result:", extractInnerResult(sl.Body), "]\n")
	}
	return sl.Rest, true
}

type toolResultSlice struct {
	Body string
	Rest string
}

func sliceToolResultBody(rest string) toolResultSlice {
	rest = strings.TrimLeft(rest, " ")
	end := strings.Index(rest, "[tool_result:")
	if end < 0 {
		return toolResultSlice{Body: rest, Rest: ""}
	}
	return toolResultSlice{Body: rest[:end], Rest: rest[end:]}
}

// extractInnerResult —— wrapper JSON {"ok":true,"result":...} 里的 result
// 字段；如果不是 wrapper，返原 raw。
func extractInnerResult(raw string) string {
	raw = strings.TrimSpace(raw)
	var wrap struct {
		Result json.RawMessage `json:"result"`
	}
	if err := json.Unmarshal([]byte(raw), &wrap); err != nil || len(wrap.Result) == 0 {
		return raw
	}
	return string(wrap.Result)
}

func nextScriptedToolCall(ctx context.Context, m *MockProvider) *StreamToolCall {
	if m.scriptURL == "" {
		return nil
	}
	tool, err := m.fetchScriptedTool(ctx)
	if err != nil || tool == nil {
		return nil
	}
	return &StreamToolCall{
		ID:    "mock-scripted-1",
		Name:  tool.Name,
		Input: tool.Args,
	}
}

// nextCorpusToolCall —— mock 模仿"先 search 再 read"行为：
//   - tools 不含 corpus_search → 不调
//   - 还没 corpus_search 的 tool_result → 调 corpus_search
//   - 有 search 结果但还没 corpus_read 的 → 解析 path 调 corpus_read
//   - 都调过 → 返 nil (caller 走 text reply)
func nextCorpusToolCall(req *ChatRequest) *StreamToolCall {
	if !hasTool(req.Tools, mockSearchTool) {
		return nil
	}
	if !hasToolResult(req.Messages, mockSearchTool) {
		return makeSearchToolCall(req.Messages)
	}
	if hasTool(req.Tools, mockReadTool) && !hasToolResult(req.Messages, mockReadTool) {
		return makeReadToolCall(req.Messages)
	}
	return nil
}

func makeSearchToolCall(messages []Message) *StreamToolCall {
	query := lastUserContent(messages)
	args, err := json.Marshal(map[string]string{"query": query})
	if err != nil {
		return nil
	}
	return &StreamToolCall{ID: "mock-search-1", Name: mockSearchTool, Input: args}
}

func makeReadToolCall(messages []Message) *StreamToolCall {
	path := firstPathFromLastToolResult(messages, mockSearchTool)
	if path == "" {
		return nil
	}
	args, err := json.Marshal(map[string]string{"path": path})
	if err != nil {
		return nil
	}
	return &StreamToolCall{ID: "mock-read-1", Name: mockReadTool, Input: args}
}

// hasToolResult —— messages 里是否已含 tool=name 的 tool_result 段。
// 实际 wire format: assistant 消息里 content 含 "[tool_result:name]" 标签
// (跟前端 agent-core 的 toolResultAsMessage 同 prefix)。
func hasToolResult(messages []Message, name string) bool {
	tag := "[tool_result:" + name + "]"
	for i := range messages {
		if strings.Contains(messages[i].Content, tag) {
			return true
		}
	}
	return false
}

// firstPathFromLastToolResult —— 找最后一个 tool=name 的 tool_result，
// 解析它的 result JSON 取第一个 path。
func firstPathFromLastToolResult(messages []Message, name string) string {
	tag := "[tool_result:" + name + "]"
	for _, m := range slices.Backward(messages) {
		jsonStr := extractAfterTag(m.Content, tag)
		if jsonStr != "" {
			return extractPathFromToolResultJSON(jsonStr)
		}
	}
	return ""
}

func extractAfterTag(content, tag string) string {
	idx := strings.Index(content, tag)
	if idx < 0 {
		return ""
	}
	jsonStart := idx + len(tag)
	if jsonStart >= len(content) {
		return ""
	}
	return content[jsonStart:]
}

// toolResultWrap —— 跟前端 toolResultAsMessage 输出对齐:
// `{"ok":true,"result":[{"path":"..."}, ...]}`。
type toolResultWrap struct {
	Result []toolResultRow `json:"result"`
}

type toolResultRow struct {
	Path string `json:"path"`
}

func extractPathFromToolResultJSON(raw string) string {
	raw = strings.TrimSpace(raw)
	var wrap toolResultWrap
	if err := json.Unmarshal([]byte(raw), &wrap); err == nil {
		if p := firstNonEmptyPath(wrap.Result); p != "" {
			return p
		}
	}
	// fallback: maybe result 是 raw JSON array
	return firstPathFromSearchResult(raw)
}

func firstNonEmptyPath(rows []toolResultRow) string {
	for i := range rows {
		if rows[i].Path != "" {
			return rows[i].Path
		}
	}
	return ""
}

func emitToolCallAndDone(
	ctx context.Context, ch chan<- StreamEvent, call *StreamToolCall,
) {
	select {
	case <-ctx.Done():
		return
	case ch <- StreamEvent{Type: "tool_call", ToolCall: call}:
	}
	select {
	case <-ctx.Done():
		return
	case ch <- StreamEvent{Type: "done", Stop: "tool_use"}:
	}
}

func emitTextReplyAndDone(
	ctx context.Context, ch chan<- StreamEvent, reply string,
) {
	// 一次 emit 整段 (不再做 16-char 假流式 chunking)；e2e 断言 raw body
	// 含 marker 时 chunk 边界会切散 substring。caller 真要逐字流式可以
	// 在 caller 侧拆。
	select {
	case <-ctx.Done():
		return
	case ch <- StreamEvent{Type: "text", Text: reply}:
	}
	pushDone(ctx, ch, "end_turn")
}

func pushDone(ctx context.Context, ch chan<- StreamEvent, stop string) {
	select {
	case <-ctx.Done():
	case ch <- StreamEvent{Type: "done", Stop: stop}:
	}
}

// chunksOf + mockChunkSize 已删 — emitTextReplyAndDone 一次 emit 整段。
