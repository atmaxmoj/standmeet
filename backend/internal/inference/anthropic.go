// anthropic.go —— Anthropic Messages API streaming client。
//
// 协议参考：https://docs.anthropic.com/en/api/messages-streaming
// 用 net/http 直连，不引第三方 SDK。
//
//   POST /v1/messages  body: { model, max_tokens, messages: [...], stream: true }
//   headers: X-Api-Key, Anthropic-Version, Content-Type
//   返 SSE：event:{type}\ndata:{json}\n\n
//     - message_start / content_block_start / content_block_delta
//       (data.delta.{type:text_delta, text}) / content_block_stop /
//       message_delta / message_stop
//
// 错误码映射：401 → ErrInvalidAPIKey; 429 → ErrRateLimited; 402 →
//   ErrPaymentRequired; 400 → ErrContextTooLong/ContentPolicy/ModelNotFound;
//   5xx → ErrServerSide; 503 overloaded → ErrOverloaded.

package inference

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	anthropicDefaultBase    = "https://api.anthropic.com"
	anthropicDefaultModel   = "claude-haiku-4-5-20251001"
	anthropicVersion        = "2023-06-01"
	anthropicDefaultMaxTok  = 1024
	anthropicStreamBufBytes = 1 << 20 // 1 MiB / line
	anthropicStreamChanBuf  = 64
	anthropicHTTPTimeout    = 60 * time.Second
	httpServerErrorBoundary = 500
)

// AnthropicProvider —— 真 Anthropic API client；owner 配置自己的 key 后由
// resolver 实例化。BaseURL 可被注入（用于测试 stub server）。
type AnthropicProvider struct {
	client  *http.Client
	apiKey  string
	baseURL string
	model   string
}

// AnthropicConfig —— 构造 AnthropicProvider 用。BaseURL / Model 留空走默认。
type AnthropicConfig struct {
	APIKey  string
	BaseURL string
	Model   string
}

// NewAnthropic —— 构造 AnthropicProvider。APIKey 必填。
func NewAnthropic(cfg AnthropicConfig) *AnthropicProvider {
	base := cfg.BaseURL
	if base == "" {
		base = anthropicDefaultBase
	}
	model := cfg.Model
	if model == "" {
		model = anthropicDefaultModel
	}
	return &AnthropicProvider{
		client:  &http.Client{Timeout: anthropicHTTPTimeout},
		apiKey:  cfg.APIKey,
		baseURL: base,
		model:   model,
	}
}

// Name 实现 Provider 接口。
func (*AnthropicProvider) Name() string { return "anthropic" }

// Provider.Stream (老 agent-loop entry) 已删 —— D-5 后 backend agent
// loop 走 server-side usecases.streamReply 循环，调 StreamSingleTurn。
// 这里只保留 StreamSingleTurn (anthropic_single_turn.go) 入口。

func (a *AnthropicProvider) buildHTTPRequest(
	ctx context.Context, body []byte,
) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		a.baseURL+"/v1/messages", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("anthropic: build req: %w", err)
	}
	req.Header.Set("X-Api-Key", a.apiKey)
	req.Header.Set("Anthropic-Version", anthropicVersion)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	return req, nil
}

// 老 simple-stream wire types (anthropicMsg / anthropicReq / buildAnthropicBody
// / filterUserAssistantMessages) 已删 (D-5)。agentTurnStream 走自己的
// anthropicAgentMsg shape。

func pickAnthropicModel(reqModel, defaultModel string) string {
	if reqModel != "" {
		return reqModel
	}
	return defaultModel
}

func pickAnthropicMaxTokens(n int) int {
	if n > 0 {
		return n
	}
	return anthropicDefaultMaxTok
}

// filterUserAssistantMessages / translateAnthropicStatus 已删 (D-5)。
// agent loop 用 translateAnthropicStatusFromBody (在 anthropic_tools.go)。

// statusSentinel —— 直接 map 到 inference sentinel 的状态码；nil 表示需要
// caller 再细分（400 走 classifyAnthropic400，5xx 走 ServerSide 兜底）。
func statusSentinel(code int) error {
	switch code {
	case http.StatusUnauthorized, http.StatusForbidden:
		return ErrInvalidAPIKey
	case http.StatusTooManyRequests:
		return ErrRateLimited
	case http.StatusPaymentRequired:
		return ErrPaymentRequired
	case http.StatusServiceUnavailable:
		return ErrOverloaded
	}
	return nil
}

func classifyAnthropic400(body string) error {
	lower := strings.ToLower(body)
	switch {
	case strings.Contains(lower, "context"), strings.Contains(lower, "too long"):
		return ErrContextTooLong
	case strings.Contains(lower, "content policy"), strings.Contains(lower, "policy violation"):
		return ErrContentPolicy
	case strings.Contains(lower, "model"):
		return ErrModelNotFound
	}
	return fmt.Errorf("anthropic 400: %s", body)
}

func normalizeNetErr(err error) error {
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "timeout") || strings.Contains(msg, "deadline") {
		return ErrTimeout
	}
	return ErrNetwork
}

// 老 SSE event wire types (anthropicEvent/Delta/Error) + parseAnthropicSSE
// + emitAnthropicEvent + dispatchAnthropicEventType 已删 (D-5)。
// SSE 解析现在走 anthropic_sse.go 里的 parseAnthropicAgentSSE，按 content
// block 维护，能解 text + tool_use 两种 block。

func closeBody(b io.Closer) {
	// best-effort；Close 在 read 完了的 body 上没什么可救的，赋个 _ 让
	// errcheck 看得见我们故意 ignore。
	cerr := b.Close()
	_ = cerr
}
