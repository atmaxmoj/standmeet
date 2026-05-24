// mock.go —— MockProvider 给 e2e / dev 用。
//
// 行为：
//   • req.Tools 空 → 老路径：直接流回 INFERENCE_MOCK_REPLY 文本。
//   • req.Tools 非空 → 模拟 agent loop：
//       1. 调 search_corpus_entries({query: <last user msg>})
//       2. 解析返回 JSON，挑第一条 path
//       3. 调 read_corpus_entry({path: <that path>})
//       4. 流回 MOCK_REPLY 文本
//     readCollector（caller 注入的 ExecuteTool 回调里）自然记下"AI 真读了哪条"，
//     让 cited 精度对齐"AI 真读" 而不是"corpus 全集"。
//
// 启用：env INFERENCE_PROVIDER=mock + 可选 INFERENCE_MOCK_REPLY="..."。

package inference

import (
	"context"
	"encoding/json"
	"os"
	"slices"
	"strings"
	"time"
)

const (
	defaultMockReply  = "Hello, this is alice's AI. I'm running in mock mode for tests."
	mockChunkInterval = 5 * time.Millisecond
	mockSearchTool    = "search_corpus_entries"
	mockReadTool      = "read_corpus_entry"
)

// MockProvider —— 不调外部 API 的 provider。
type MockProvider struct {
	reply string
}

// NewMockProvider 构造 MockProvider；reply 取 INFERENCE_MOCK_REPLY 否则默认。
func NewMockProvider() *MockProvider {
	reply := os.Getenv("INFERENCE_MOCK_REPLY")
	if reply == "" {
		reply = defaultMockReply
	}
	return &MockProvider{reply: reply}
}

// Name —— provider 名字。
func (*MockProvider) Name() string { return "mock" }

// Stream —— 按 ChatRequest 决定是否走 agent loop。
func (m *MockProvider) Stream(ctx context.Context, req *ChatRequest) (<-chan Chunk, error) {
	ch := make(chan Chunk, len(m.reply)+1)
	go m.run(ctx, req, ch)
	return ch, nil
}

func (m *MockProvider) run(ctx context.Context, req *ChatRequest, ch chan<- Chunk) {
	defer close(ch)
	skillResults := maybeRunMockToolLoop(ctx, req)
	// mock echoes the system prompt verbatim before the canned reply. visitor
	// chat e2es 借此 verify owner-curated skill prompts 真的拼进了 system，
	// 而不是只挂在 DB / session 上。prod 路径不走 mock，影响仅限 env=mock。
	echoSystem(ctx, req, ch)
	echoSkillResults(ctx, skillResults, ch)
	m.streamReply(ctx, ch)
}

func echoSkillResults(ctx context.Context, results []string, ch chan<- Chunk) {
	for _, r := range results {
		select {
		case <-ctx.Done():
			return
		case ch <- Chunk{Text: "[skill_result:" + r + "]\n"}:
		}
	}
}

func echoSystem(ctx context.Context, req *ChatRequest, ch chan<- Chunk) {
	if req.System == "" {
		return
	}
	select {
	case <-ctx.Done():
		return
	case ch <- Chunk{Text: "[system:" + req.System + "]\n"}:
	}
}

// maybeRunMockToolLoop —— 当 caller 注册了 tools + executor 时模拟一轮 search→read。
// executor 失败不阻塞：mock 是 e2e fixture，遇到 deny / not-found 让 collector
// 不收就行；文本回复仍然流出。
// maybeRunMockToolLoop —— 跑一轮模拟 tool dispatch；返回 skill_* tool 的
// 输出，let run() echo 到 reply 让 e2e 能 assert。
func maybeRunMockToolLoop(ctx context.Context, req *ChatRequest) []string {
	if !canRunMockTools(req) {
		return nil
	}
	path := mockDoSearch(ctx, req)
	if path != "" {
		mockDoRead(ctx, req, path)
	}
	return mockRunFirstSkillTool(ctx, req)
}

// mockRunFirstSkillTool —— mock provider 顺手调一下第一个 skill_* tool，
// 让 e2e 能验证 owner-curated 脚本真的跑到了 sandbox。无 skill 工具就跳。
// 返 tool 输出 string (caller echo)。失败不阻塞 reply。
func mockRunFirstSkillTool(ctx context.Context, req *ChatRequest) []string {
	if req.ExecuteTool == nil {
		return nil
	}
	name := firstSkillToolName(req.Tools)
	if name == "" {
		return nil
	}
	out, err := req.ExecuteTool(ctx, name, []byte("{}"))
	if err != nil {
		return nil
	}
	return []string{out}
}

func firstSkillToolName(tools []ToolSpec) string {
	for i := range tools {
		if len(tools[i].Name) > len(mockSkillPrefix) &&
			tools[i].Name[:len(mockSkillPrefix)] == mockSkillPrefix {
			return tools[i].Name
		}
	}
	return ""
}

const mockSkillPrefix = "skill_"

func canRunMockTools(req *ChatRequest) bool {
	return len(req.Tools) > 0 && req.ExecuteTool != nil &&
		hasTool(req.Tools, mockSearchTool) && hasTool(req.Tools, mockReadTool)
}

func mockDoSearch(ctx context.Context, req *ChatRequest) string {
	query := lastUserContent(req.Messages)
	args, merr := json.Marshal(map[string]string{"query": query})
	if merr != nil {
		return ""
	}
	out, terr := req.ExecuteTool(ctx, mockSearchTool, args)
	if terr != nil {
		return ""
	}
	return firstPathFromSearchResult(out)
}

func mockDoRead(ctx context.Context, req *ChatRequest, path string) {
	args, merr := json.Marshal(map[string]string{"path": path})
	if merr != nil {
		return
	}
	if _, err := req.ExecuteTool(ctx, mockReadTool, args); err != nil {
		_ = err
	}
}

// firstPathFromSearchResult —— search_corpus_entries 返 JSON array
// [{path, title, kind}, ...]；mock 挑第一条的 path。
func firstPathFromSearchResult(raw string) string {
	var rows []struct {
		Path string `json:"path"`
	}
	if err := json.Unmarshal([]byte(raw), &rows); err != nil {
		return ""
	}
	for i := range rows {
		if rows[i].Path != "" {
			return rows[i].Path
		}
	}
	return ""
}

func hasTool(tools []ToolSpec, name string) bool {
	for i := range tools {
		if tools[i].Name == name {
			return true
		}
	}
	return false
}

func lastUserContent(msgs []Message) string {
	for _, m := range slices.Backward(msgs) {
		if m.Role == "user" {
			return m.Content
		}
	}
	return ""
}

func (m *MockProvider) streamReply(ctx context.Context, ch chan<- Chunk) {
	words := strings.SplitAfter(m.reply, " ")
	for _, w := range words {
		select {
		case <-ctx.Done():
			return
		case <-time.After(mockChunkInterval):
		}
		ch <- Chunk{Text: w}
	}
	ch <- Chunk{Done: true}
}
