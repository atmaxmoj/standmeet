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
	emitTextReplyAndDone(ctx, ch, m.reply)
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
	if !pushTextChunks(ctx, ch, reply) {
		return
	}
	pushDone(ctx, ch, "end_turn")
}

func pushTextChunks(ctx context.Context, ch chan<- StreamEvent, reply string) bool {
	for _, chunk := range chunksOf(reply, mockChunkSize) {
		select {
		case <-ctx.Done():
			return false
		case ch <- StreamEvent{Type: "text", Text: chunk}:
		}
	}
	return true
}

func pushDone(ctx context.Context, ch chan<- StreamEvent, stop string) {
	select {
	case <-ctx.Done():
	case ch <- StreamEvent{Type: "done", Stop: stop}:
	}
}

const mockChunkSize = 16

func chunksOf(s string, size int) []string {
	if size <= 0 || s == "" {
		return []string{s}
	}
	out := make([]string, 0, (len(s)/size)+1)
	for i := 0; i < len(s); i += size {
		end := min(i+size, len(s))
		out = append(out, s[i:end])
	}
	return out
}
