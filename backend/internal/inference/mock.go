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

// Provider.Stream (+ run/echoSystem/echoSkillResults) 已删 (D-5)。Mock
// 走 StreamSingleTurn (mock_single_turn.go)；agent loop 移到
// usecases.streamReply 用 StreamSingleTurn 迭代驱动。
//
// 老 mock 同时 echo "[system:...]" + "[skill_result:...]" 让 e2e 验 system
// prompt 装配，新路径 StreamSingleTurn 也需要保留这两条 echo (e2e 覆盖)。
// 这里把 echo 整合进 emitTextReplyAndDone (在 mock_single_turn.go) 之前先
// 直接保留 system + skill echo 到独立 helper 给 single_turn 用。

// maybeRunMockToolLoop —— 当 caller 注册了 tools + executor 时模拟一轮 search→read。
// executor 失败不阻塞：mock 是 e2e fixture，遇到 deny / not-found 让 collector
// 不收就行；文本回复仍然流出。
// maybeRunMockToolLoop / mockRunFirstExtTool / mockRunFirstSkillTool 已删
// (D-5)。skill_*/ext_* tool 调用走 mock_single_turn.go nextSkillOrExtToolCall
// emit tool_call，usecases.streamReply 执行 binding，结果回 messages
// 让 mock 下一轮提取出来 echo。

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

// maybeRunScriptedTool / scriptingEnabled 已删 (D-5)。scripted tool 现在
// 走 mock_single_turn.go nextScriptedToolCall emit tool_call 让
// usecases.streamReply 执行；前端 pi loop 也同路径 (走 /tools/{name})。

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

// canRunMockTools / mockDoSearch / mockDoRead 已删 (D-5)。tool dispatch
// 现在 emit tool_call 由 caller 调 binding；mock_single_turn.go 按
// messages 历史决定下一步 tool_call。

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

// streamReply 已删 (D-5)。文本流走 emitTextReplyAndDone (mock_single_turn.go)
// 直接 chunk reply 不再做 word-by-word artificial delay (e2e 不依赖时序)。
// mockChunkInterval / Chunk 类型也可一并删，这里留个 var _ 占位避免链
// 式 import 损坏。
