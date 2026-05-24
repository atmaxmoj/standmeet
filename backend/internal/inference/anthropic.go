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
	"bufio"
	"bytes"
	"context"
	"encoding/json"
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

// Stream 实现 Provider 接口。
//
// 有 tools 时走 agent loop（runToolLoop，内部 non-streaming 调用 + 自循环，
// 最终 text 当一坨 Chunk 推出来）；无 tools 时走 streaming SSE 老路径。
func (a *AnthropicProvider) Stream(
	ctx context.Context, req *ChatRequest,
) (<-chan Chunk, error) {
	if len(req.Tools) > 0 && req.ExecuteTool != nil {
		out := make(chan Chunk, anthropicStreamChanBuf)
		go a.runToolLoop(ctx, req, out)
		return out, nil
	}
	return a.streamSimple(ctx, req)
}

func (a *AnthropicProvider) streamSimple(
	ctx context.Context, req *ChatRequest,
) (<-chan Chunk, error) {
	body, err := buildAnthropicBody(req, a.model, true)
	if err != nil {
		return nil, err
	}
	httpReq, herr := a.buildHTTPRequest(ctx, body)
	if herr != nil {
		return nil, herr
	}
	resp, rerr := a.client.Do(httpReq)
	if rerr != nil {
		return nil, normalizeNetErr(rerr)
	}
	if resp.StatusCode >= http.StatusBadRequest {
		return nil, translateAnthropicStatus(resp)
	}
	out := make(chan Chunk, anthropicStreamChanBuf)
	go parseAnthropicSSE(resp.Body, out)
	return out, nil
}

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

type anthropicMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type anthropicReq struct {
	Model     string         `json:"model"`
	System    string         `json:"system,omitempty"`
	Messages  []anthropicMsg `json:"messages"`
	MaxTokens int            `json:"max_tokens"`
	Stream    bool           `json:"stream"`
}

func buildAnthropicBody(req *ChatRequest, defaultModel string, stream bool) ([]byte, error) {
	msgs := filterUserAssistantMessages(req.Messages)
	body, err := json.Marshal(anthropicReq{
		Model:     pickAnthropicModel(req.Model, defaultModel),
		System:    req.System,
		Messages:  msgs,
		MaxTokens: pickAnthropicMaxTokens(req.MaxTokens),
		Stream:    stream,
	})
	if err != nil {
		return nil, fmt.Errorf("anthropic: marshal body: %w", err)
	}
	return body, nil
}

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

func filterUserAssistantMessages(in []Message) []anthropicMsg {
	out := make([]anthropicMsg, 0, len(in))
	for i := range in {
		if in[i].Role == "system" {
			continue // anthropic 用 top-level system 字段
		}
		out = append(out, anthropicMsg{Role: in[i].Role, Content: in[i].Content})
	}
	return out
}

func translateAnthropicStatus(resp *http.Response) error {
	defer closeBody(resp.Body)
	bodyText, rerr := io.ReadAll(resp.Body)
	if rerr != nil {
		bodyText = []byte("(read body err)")
	}
	if sentinel := statusSentinel(resp.StatusCode); sentinel != nil {
		return sentinel
	}
	if resp.StatusCode == http.StatusBadRequest {
		return classifyAnthropic400(string(bodyText))
	}
	if resp.StatusCode >= httpServerErrorBoundary {
		return ErrServerSide
	}
	return fmt.Errorf("anthropic %d: %s", resp.StatusCode, string(bodyText))
}

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

type anthropicEvent struct {
	Error *anthropicEventErrorObj `json:"error,omitempty"`
	Delta *anthropicEventDelta    `json:"delta,omitempty"`
	Type  string                  `json:"type"`
}

type anthropicEventDelta struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type anthropicEventErrorObj struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

func parseAnthropicSSE(body io.ReadCloser, out chan<- Chunk) {
	defer closeBody(body)
	defer close(out)
	sc := bufio.NewScanner(body)
	sc.Buffer(make([]byte, 0, anthropicStreamBufBytes), anthropicStreamBufBytes)
	for sc.Scan() {
		line := sc.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" {
			continue
		}
		if !emitAnthropicEvent(data, out) {
			return
		}
	}
}

// emitAnthropicEvent —— 一行 data 解码 + 翻译成 Chunk。返 false 表流要终止。
func emitAnthropicEvent(data string, out chan<- Chunk) bool {
	var ev anthropicEvent
	if err := json.Unmarshal([]byte(data), &ev); err != nil {
		return true // 跳过 schema 不识别的事件
	}
	if ev.Error != nil {
		out <- Chunk{Error: fmt.Errorf("anthropic: %s", ev.Error.Message)}
		return false
	}
	return dispatchAnthropicEventType(&ev, out)
}

func dispatchAnthropicEventType(ev *anthropicEvent, out chan<- Chunk) bool {
	if ev.Type == "content_block_delta" && ev.Delta != nil && ev.Delta.Type == "text_delta" {
		out <- Chunk{Text: ev.Delta.Text}
		return true
	}
	if ev.Type == "message_stop" {
		out <- Chunk{Done: true}
		return false
	}
	return true
}

func closeBody(b io.Closer) {
	// best-effort；Close 在 read 完了的 body 上没什么可救的，赋个 _ 让
	// errcheck 看得见我们故意 ignore。
	cerr := b.Close()
	_ = cerr
}
