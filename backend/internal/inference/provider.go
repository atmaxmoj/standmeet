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
type ChatRequest struct {
	Model       string
	System      string
	Messages    []Message
	MaxTokens   int
	Temperature float64
}

// Chunk —— 流式响应一片（token delta 或 done）。
type Chunk struct {
	Error error
	Text  string
	Done  bool
}

// Provider —— 一个 LLM provider 的抽象。Stream 推回 channel，关闭通道表示完成。
type Provider interface {
	Name() string
	Stream(ctx context.Context, req *ChatRequest) (<-chan Chunk, error)
}
