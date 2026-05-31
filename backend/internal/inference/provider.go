// Package inference 抽象 LLM provider（Anthropic / OpenAI / Mock）。
//
// 设计 goals：
//  1. usecase 层只看 Provider 接口，不绑 SDK；
//  2. 第三方 SDK 的具体错误码（rate limit / context too long / quota / 5xx /
//     content policy / network 等）全部翻成本包 sentinel error，让 routes
//     层走统一的 apierr.Case 表 → HTTP envelope；
//  3. e2e 走 MockProvider，按 INFERENCE_PROVIDER=mock 启用，从脚本回放。
package inference

import (
	"context"
	"errors"
)

// Sentinel errors —— 第三方所有错误码都先 normalize 到这里，再交给 apierr。
// 命名跟 HTTP 状态码语义对应：
//   - RateLimited     → 429
//   - ContextTooLong  → 400
//   - InvalidAPIKey   → 401
//   - PaymentRequired → 402
//   - ContentPolicy   → 400
//   - ModelNotFound   → 400
//   - Overloaded      → 503
//   - ServerSide      → 502
//   - Timeout         → 504
//   - Network         → 503
var (
	ErrRateLimited     = errors.New("inference: rate limited")
	ErrContextTooLong  = errors.New("inference: context length exceeded")
	ErrInvalidAPIKey   = errors.New("inference: invalid api key")
	ErrPaymentRequired = errors.New("inference: payment required / quota exhausted")
	ErrContentPolicy   = errors.New("inference: content policy violation")
	ErrModelNotFound   = errors.New("inference: model not found")
	ErrOverloaded      = errors.New("inference: provider overloaded")
	ErrServerSide      = errors.New("inference: provider 5xx")
	ErrTimeout         = errors.New("inference: timeout")
	ErrNetwork         = errors.New("inference: network failure")
)

// Message —— 对话消息抽象（cross-provider）。
type Message struct {
	Role    string // 'system' | 'user' | 'assistant'
	Content string
}

// ChatRequest —— 一次推理请求。
//
// Tools 非空 → 走 agent loop：provider 在内部循环 (assistant tool_use →
// caller-provided ExecuteTool → tool_result → 重发) 直到 stop_reason != tool_use
// 或到 max_turns；只把 text content 推回 Chunk channel。ToolSpec /
// ToolExecutor 定义在 tools.go 里。
type ChatRequest struct {
	ExecuteTool ToolExecutor
	Model       string
	System      string
	Messages    []Message
	Tools       []ToolSpec
	MaxTokens   int
	Temperature float64
}

// Chunk —— 流式响应一片（token delta 或 done）。
type Chunk struct {
	Error error
	Text  string
	Done  bool
}

// Provider —— 一个 LLM provider 的抽象。D-5 后只剩 StreamSingleTurn
// (single-turn 输出)；server-side agent loop 移到 usecases.streamReply
// 用 StreamSingleTurn 迭代实现。
type Provider interface {
	Name() string
	// StreamSingleTurn —— 跑**一次**调用 (不内嵌 agent loop)，把 text
	// delta + tool_use 都当 event 返。caller (browser pi-agent-core 或
	// usecases.runServerSideAgentLoop) 拿 tool_use 自己去调 per-tool
	// endpoint / binding，再以新的 messages 历史回来再调一次。
	//
	// req.Tools 非空 → provider 在 toolSpecs 里把它带给 LLM；ExecuteTool
	// 字段不读 (单轮不执行 tool)。req.Tools 空 → 纯文本生成。
	StreamSingleTurn(ctx context.Context, req *ChatRequest) (<-chan StreamEvent, error)
}
