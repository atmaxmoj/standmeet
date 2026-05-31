// mock.go —— MockProvider 给 e2e / dev 用。
//
// 行为：
//   • req.Tools 空 → 老路径：直接流回 INFERENCE_MOCK_REPLY 文本。
//   • req.Tools 非空 → 模拟 agent loop：
//       1. 调 corpus_search({query: <last user msg>})
//       2. 解析返回 JSON，挑第一条 path
//       3. 调 corpus_read({path: <that path>})
//       4. 流回 MOCK_REPLY 文本
//     readCollector（caller 注入的 ExecuteTool 回调里）自然记下"AI 真读了哪条"，
//     让 cited 精度对齐"AI 真读" 而不是"corpus 全集"。
//
// 启用：env INFERENCE_PROVIDER=mock + 可选 INFERENCE_MOCK_REPLY="..."。

package inference

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"slices"
	"strings"
	"time"
)

const (
	defaultMockReply  = "Hello, this is alice's AI. I'm running in mock mode for tests."
	mockChunkInterval = 5 * time.Millisecond
	// D-3: tool 名 snake_case 跟 LLM tool spec + URL path 同源。
	mockSearchTool = "corpus_search"
	mockReadTool   = "corpus_read"
)

// MockProvider —— 不调外部 API 的 provider。
//
// scriptURL —— 可选；非空时每轮 Stream 之前 GET <scriptURL>/take_next_tool
// 拿一个 e2e 脚本指定的 tool call (typically calendar_book)，让 specs
// 控制 mock 调啥 tool 用啥 args 而不是写死 search→read。
type MockProvider struct {
	reply     string
	scriptURL string
}

// NewMockProvider 构造 MockProvider；reply 取 INFERENCE_MOCK_REPLY 否则默认。
// INFERENCE_MOCK_SCRIPT_URL 空时禁用 scripting。
func NewMockProvider() *MockProvider {
	reply := os.Getenv("INFERENCE_MOCK_REPLY")
	if reply == "" {
		reply = defaultMockReply
	}
	return &MockProvider{
		reply:     reply,
		scriptURL: os.Getenv("INFERENCE_MOCK_SCRIPT_URL"),
	}
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
	m.maybeRunScriptedTool(ctx, req)
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
// maybeRunMockToolLoop —— 跑一轮模拟 tool dispatch；返回 skill_* / ext_*
// tool 的输出，let run() echo 到 reply 让 e2e 能 assert。
func maybeRunMockToolLoop(ctx context.Context, req *ChatRequest) []string {
	if !canRunMockTools(req) {
		return []string{}
	}
	path := mockDoSearch(ctx, req)
	if path != "" {
		mockDoRead(ctx, req, path)
	}
	out := mockRunFirstSkillTool(ctx, req)
	out = append(out, mockRunFirstExtTool(ctx, req)...)
	return out
}

// mockRunFirstExtTool —— mock 顺手调一个外部 MCP server 的 tool，让 e2e
// 验证 backend 真当 MCP 客户端连上、ListTools、CallTool 一连串走通。
func mockRunFirstExtTool(ctx context.Context, req *ChatRequest) []string {
	if req.ExecuteTool == nil {
		return []string{}
	}
	name := firstExtToolName(req.Tools)
	if name == "" {
		return []string{}
	}
	out, err := req.ExecuteTool(ctx, name, []byte("{}"))
	if err != nil {
		return []string{}
	}
	return []string{out}
}

func firstExtToolName(tools []ToolSpec) string {
	for i := range tools {
		if len(tools[i].Name) > len(mockExtPrefix) &&
			tools[i].Name[:len(mockExtPrefix)] == mockExtPrefix {
			return tools[i].Name
		}
	}
	return ""
}

const mockExtPrefix = "ext_"

// mockRunFirstSkillTool —— mock provider 顺手调一下第一个 skill_* tool，
// 让 e2e 能验证 owner-curated 脚本真的跑到了 sandbox。无 skill 工具就跳。
// 返 tool 输出 string (caller echo)。失败不阻塞 reply。
func mockRunFirstSkillTool(ctx context.Context, req *ChatRequest) []string {
	if req.ExecuteTool == nil {
		return []string{}
	}
	name := firstSkillToolName(req.Tools)
	if name == "" {
		return []string{}
	}
	out, err := req.ExecuteTool(ctx, name, []byte("{}"))
	if err != nil {
		return []string{}
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

// scriptedTool —— mock LLM 下一步要调的 tool。args 是 raw JSON 给
// ExecuteTool(name, []byte) 直接喂。
type scriptedTool struct {
	Name string          `json:"name"`
	Args json.RawMessage `json:"args"`
}

type scriptedToolWire struct {
	Tool *scriptedTool `json:"tool"`
}

const scriptFetchTimeout = 2 * time.Second

// maybeRunScriptedTool —— 若配 INFERENCE_MOCK_SCRIPT_URL 且 queue 中有
// scripted tool，调用 req.ExecuteTool(name, args) 一次。
func (m *MockProvider) maybeRunScriptedTool(ctx context.Context, req *ChatRequest) {
	if !m.scriptingEnabled(req) {
		return
	}
	tool, err := m.fetchScriptedTool(ctx)
	if err != nil || tool == nil {
		return
	}
	if _, terr := req.ExecuteTool(ctx, tool.Name, tool.Args); terr != nil {
		_ = terr
	}
}

func (m *MockProvider) scriptingEnabled(req *ChatRequest) bool {
	return m.scriptURL != "" && req.ExecuteTool != nil
}

func (m *MockProvider) fetchScriptedTool(ctx context.Context) (*scriptedTool, error) {
	resp, err := m.dispatchScriptFetch(ctx)
	if err != nil {
		return nil, err
	}
	out, decErr := decodeScriptedTool(resp)
	if cerr := resp.Body.Close(); cerr != nil && decErr == nil {
		return nil, fmt.Errorf("mock script: close body: %w", cerr)
	}
	return out, decErr
}

func (m *MockProvider) dispatchScriptFetch(ctx context.Context) (*http.Response, error) {
	rctx, cancel := context.WithTimeout(ctx, scriptFetchTimeout)
	defer cancel()
	url := m.scriptURL + "/__mock/inference/take_next_tool"
	req, rerr := http.NewRequestWithContext(rctx, http.MethodGet, url, http.NoBody)
	if rerr != nil {
		return nil, fmt.Errorf("mock script: new request: %w", rerr)
	}
	resp, derr := http.DefaultClient.Do(req)
	if derr != nil {
		return nil, fmt.Errorf("mock script: do: %w", derr)
	}
	return resp, nil
}

func decodeScriptedTool(resp *http.Response) (*scriptedTool, error) {
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("mock script: status %d", resp.StatusCode)
	}
	body, berr := io.ReadAll(resp.Body)
	if berr != nil {
		return nil, fmt.Errorf("mock script: read body: %w", berr)
	}
	var wire scriptedToolWire
	if uerr := json.Unmarshal(body, &wire); uerr != nil {
		return nil, fmt.Errorf("mock script: decode: %w", uerr)
	}
	return wire.Tool, nil
}

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

// firstPathFromSearchResult —— corpus_search 返 JSON array
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
