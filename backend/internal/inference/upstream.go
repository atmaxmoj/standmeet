// Package inference —— upstream credential resolution + thin Anthropic
// HTTP helpers. Backend does NOT parse upstream SSE; pi-agent-core (in
// the browser, via @standmeet/agent-core) consumes the Anthropic native
// stream and runs the agent loop. Backend's only job:
//
//  1. resolve owner / BYOAI credentials (Cred + Resolver)
//  2. forward bytes between visitor's /inference/stream call and the
//     upstream Anthropic /v1/messages call (routes/public/inference_stream.go)
//  3. one-shot non-streaming calls (visitor_summary) using SendAnthropic
//
// v1 supports only anthropic-compatible upstreams. owner.ai_provider !=
// 'anthropic' → ErrUnsupportedProvider; v2 may add openai-compat by
// translating openai SSE → anthropic SSE on the fly.
package inference

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/wangsijie/standmeet/internal/domain"
)

const (
	anthropicVersion       = "2023-06-01"
	anthropicDefaultMaxTok = 1024
	upstreamHTTPTimeout    = 60 * time.Second
	upstreamServerErrBndry = 500
)

// Cred —— resolved upstream credential. all four fields non-empty after
// a successful Resolve.
type Cred struct {
	Provider string
	Key      string
	Endpoint string
	Model    string
}

// Resolver —— pick the right cred for this request (owner row vs visitor
// BYOAI envelope). Implementation: OwnerKeyResolver in resolver.go.
type Resolver interface {
	Resolve(ctx context.Context, in *ResolveInput) (*Cred, error)
}

// ResolveInput —— per-request input. BYOAI non-nil only in mode='byoai'.
// fieldalignment: pointer first.
type ResolveInput struct {
	BYOAI   *domain.AICredential
	OwnerID string
	Mode    string
}

// AnthropicMsg —— content-block carrier on the /v1/messages wire. text,
// tool_use, tool_result variants share the struct; per-type fields are
// optional.
type AnthropicMsg struct {
	Role    string            `json:"role"`
	Content []json.RawMessage `json:"content"`
}

// NewTextMessage —— wrap plaintext into a single text content block.
// Used by visitor_summary (only sends user text, no tool blocks).
// json.Marshal on a single typed block never fails; ignore the error
// after a one-shot assignment.
func NewTextMessage(role, text string) AnthropicMsg {
	body, merr := json.Marshal(anthropicContentBlock{Type: "text", Text: text})
	_ = merr
	return AnthropicMsg{Role: role, Content: []json.RawMessage{body}}
}

// MessageReq —— inputs to BuildAnthropicBody. Stream is set per-caller.
type MessageReq struct {
	System    string
	Model     string
	Messages  []AnthropicMsg
	Tools     []ToolSpec
	MaxTokens int
}

type anthropicTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"input_schema"`
}

type anthropicBody struct {
	Model     string          `json:"model"`
	System    string          `json:"system,omitempty"`
	Messages  []AnthropicMsg  `json:"messages"`
	Tools     []anthropicTool `json:"tools,omitempty"`
	MaxTokens int             `json:"max_tokens"`
	Stream    bool            `json:"stream,omitempty"`
}

// BuildAnthropicBody —— marshal MessageReq into the wire body. Set
// stream=true for /inference/stream forwarding, false for summary.
func BuildAnthropicBody(req *MessageReq, stream bool) ([]byte, error) {
	if req.Model == "" {
		return nil, errors.New("anthropic body: missing model")
	}
	body := anthropicBody{
		Model:     req.Model,
		System:    req.System,
		Messages:  req.Messages,
		Tools:     toolSpecsToWire(req.Tools),
		MaxTokens: pickMaxTokens(req.MaxTokens),
		Stream:    stream,
	}
	out, err := json.Marshal(&body)
	if err != nil {
		return nil, fmt.Errorf("anthropic marshal body: %w", err)
	}
	return out, nil
}

func toolSpecsToWire(in []ToolSpec) []anthropicTool {
	out := make([]anthropicTool, 0, len(in))
	for i := range in {
		out = append(out, anthropicTool{
			Name:        in[i].Name,
			Description: in[i].Description,
			InputSchema: in[i].InputSchema,
		})
	}
	return out
}

func pickMaxTokens(n int) int {
	if n > 0 {
		return n
	}
	return anthropicDefaultMaxTok
}

// OpenAnthropicStream —— POST /v1/messages stream=true; return the live
// HTTP response so caller can io.Copy(w, resp.Body) the SSE bytes to the
// visitor connection. Caller must Close resp.Body.
//
// On HTTP-level errors the body is consumed + closed and a sentinel
// error returned.
func OpenAnthropicStream(
	ctx context.Context, cred *Cred, req *MessageReq,
) (*http.Response, error) {
	if cred.Provider != "anthropic" {
		return nil, ErrUnsupportedProvider
	}
	body, berr := BuildAnthropicBody(req, true)
	if berr != nil {
		return nil, berr
	}
	resp, err := postAnthropicStreaming(ctx, cred, body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= http.StatusBadRequest {
		return nil, translateStatus(resp)
	}
	return resp, nil
}

// SendAnthropic —— POST /v1/messages stream=false; concatenate every
// text content block of the assistant reply into one string. Tool_use
// blocks ignored (one-shot summary doesn't run tools).
func SendAnthropic(
	ctx context.Context, cred *Cred, req *MessageReq,
) (string, error) {
	if cred.Provider != "anthropic" {
		return "", ErrUnsupportedProvider
	}
	body, berr := BuildAnthropicBody(req, false)
	if berr != nil {
		return "", berr
	}
	resp, err := postAnthropicOneShot(ctx, cred, body)
	if err != nil {
		return "", err
	}
	defer closeBody(resp.Body)
	if resp.StatusCode >= http.StatusBadRequest {
		return "", translateStatus(resp)
	}
	return parseAnthropicNonStream(resp.Body)
}

// postAnthropicStreaming —— POST with SSE Accept; client has no timeout
// so idle gaps between tokens don't kill the stream (ctx cancel covers
// the visitor-disconnect path).
func postAnthropicStreaming(
	ctx context.Context, cred *Cred, body []byte,
) (*http.Response, error) {
	httpReq, herr := buildAnthropicHTTPReq(ctx, cred, body)
	if herr != nil {
		return nil, herr
	}
	httpReq.Header.Set("Accept", "text/event-stream")
	client := &http.Client{}
	resp, derr := client.Do(httpReq)
	if derr != nil {
		return nil, normalizeNetErr(derr)
	}
	return resp, nil
}

// postAnthropicOneShot —— POST without SSE Accept; client has a bounded
// timeout (full request/response within upstreamHTTPTimeout).
func postAnthropicOneShot(
	ctx context.Context, cred *Cred, body []byte,
) (*http.Response, error) {
	httpReq, herr := buildAnthropicHTTPReq(ctx, cred, body)
	if herr != nil {
		return nil, herr
	}
	client := &http.Client{Timeout: upstreamHTTPTimeout}
	resp, derr := client.Do(httpReq)
	if derr != nil {
		return nil, normalizeNetErr(derr)
	}
	return resp, nil
}

func buildAnthropicHTTPReq(
	ctx context.Context, cred *Cred, body []byte,
) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		strings.TrimRight(cred.Endpoint, "/")+"/v1/messages",
		bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("anthropic: build request: %w", err)
	}
	req.Header.Set("X-Api-Key", cred.Key)
	req.Header.Set("Anthropic-Version", anthropicVersion)
	req.Header.Set("Content-Type", "application/json")
	return req, nil
}

type anthropicContentBlock struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type anthropicNonStreamResp struct {
	Content []anthropicContentBlock `json:"content"`
}

func parseAnthropicNonStream(body io.Reader) (string, error) {
	raw, rerr := io.ReadAll(body)
	if rerr != nil {
		return "", fmt.Errorf("anthropic: read body: %w", rerr)
	}
	var env anthropicNonStreamResp
	if err := json.Unmarshal(raw, &env); err != nil {
		return "", fmt.Errorf("anthropic: decode body: %w", err)
	}
	var b strings.Builder
	for i := range env.Content {
		if env.Content[i].Type == "text" {
			_, _ = b.WriteString(env.Content[i].Text)
		}
	}
	return b.String(), nil
}

func translateStatus(resp *http.Response) error {
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
	if resp.StatusCode >= upstreamServerErrBndry {
		return ErrServerSide
	}
	return fmt.Errorf("anthropic %d: %s", resp.StatusCode, string(bodyText))
}

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

func closeBody(b io.Closer) {
	cerr := b.Close()
	_ = cerr
}
