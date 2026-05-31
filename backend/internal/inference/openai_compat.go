// openai_compat.go —— OpenAI Chat Completions API streaming client。
//
// 覆盖所有走 OpenAI shape 的 provider：openai 真品 + deepseek / kimi / groq
// / siliconflow / openrouter / together / 用户自托管 ollama / vllm /
// lm-studio。Anthropic 不走这条路径（自己跑 Messages API）。
//
// 协议参考：https://platform.openai.com/docs/api-reference/chat
//   POST {BaseURL}/v1/chat/completions
//   body: { model, messages: [...], stream: true, tools?: [...] }
//   headers: Authorization: Bearer <key>, Content-Type: application/json
//   SSE: data: {...}\n\n  ...  data: [DONE]\n\n
//
// 错误码映射跟 Anthropic 一样走 statusSentinel + classifyOpenAI400；
// 复用了 anthropic.go 里的 sentinel switch（401/403/429/402/503）。
// adapter 自己不查 preset —— BaseURL / Model 必须由 caller 用 preset
// 兜底后再传进来，方便测试 stub。

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
)

const (
	openAIChatPath        = "/v1/chat/completions"
	openAIDefaultMaxTok   = 1024
	openAIStreamChanBuf   = 64
	openAIStreamBufBytes  = 1 << 20 // 1 MiB / SSE line
	openAIHTTPTimeout     = 60 * time.Second
	openAIDoneSentinel    = "[DONE]"
	openAIRoleSystem      = "system"
	openAIRoleUser        = "user"
	openAIRoleAssistant   = "assistant"
	openAIRoleTool        = "tool"
	openAIFinishToolCalls = "tool_calls"
)

// OpenAICompatProvider —— OpenAI Chat Completions 兼容 client。
// fieldalignment: pointer → 长 string → 短 string。
type OpenAICompatProvider struct {
	client   *http.Client
	apiKey   string
	baseURL  string
	model    string
	provider string // 'openai' / 'deepseek' / ...; Name() 返这个
}

// OpenAICompatConfig —— 构造 OpenAICompatProvider。
// **所有字段都是 caller 的责任** —— adapter 不查 preset。Provider /
// BaseURL / Model 全部必填，APIKey 仅 custom self-host 可空。
type OpenAICompatConfig struct {
	APIKey   string
	BaseURL  string
	Model    string
	Provider string
}

// NewOpenAICompat —— 构造 OpenAICompatProvider。
func NewOpenAICompat(cfg OpenAICompatConfig) *OpenAICompatProvider {
	return &OpenAICompatProvider{
		client:   &http.Client{Timeout: openAIHTTPTimeout},
		apiKey:   cfg.APIKey,
		baseURL:  strings.TrimRight(cfg.BaseURL, "/"),
		model:    cfg.Model,
		provider: cfg.Provider,
	}
}

// Name 实现 Provider 接口；返 provider id（'openai' / 'deepseek' / ...）
// 用于 conversation audit 区分实际跑了哪个 backend。
func (p *OpenAICompatProvider) Name() string { return p.provider }

// Stream 实现 Provider 接口。
//
// 有 tools + ExecuteTool → 走 non-streaming tool loop（OpenAI 流式 +
// tool_calls 协议太复杂且 fragments 没必要 emit）。
// Provider.Stream 已删 (D-5)。同 anthropic.go 注释。

func (p *OpenAICompatProvider) buildHTTPRequest(
	ctx context.Context, body []byte,
) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		p.baseURL+openAIChatPath, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("openai_compat: build req: %w", err)
	}
	if p.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+p.apiKey)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	return req, nil
}

// oaMsg —— Chat Completions message 形态（system/user/assistant/tool）。
// fieldalignment: slice 先 (24B header)，长 string 后。
type oaMsg struct {
	Content    string       `json:"content"`
	Role       string       `json:"role"`
	ToolCallID string       `json:"tool_call_id,omitempty"`
	ToolCalls  []oaToolCall `json:"tool_calls,omitempty"`
}

type oaToolCall struct {
	Function oaToolCallFunction `json:"function"`
	ID       string             `json:"id"`
	Type     string             `json:"type"`
}

type oaToolCallFunction struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type oaTool struct {
	Type     string         `json:"type"`
	Function oaToolFunction `json:"function"`
}

type oaToolFunction struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Parameters  json.RawMessage `json:"parameters"`
}

// oaReq —— Chat Completions request body。
type oaReq struct {
	Model     string   `json:"model"`
	Messages  []oaMsg  `json:"messages"`
	Tools     []oaTool `json:"tools,omitempty"`
	MaxTokens int      `json:"max_tokens,omitempty"`
	Stream    bool     `json:"stream"`
}

// buildOpenAIBody 已删 (D-5)。agent loop 走 openai_compat_tools.go 里的
// 自己 marshal 路径。

func pickOpenAIModel(reqModel, defaultModel string) string {
	if reqModel != "" {
		return reqModel
	}
	return defaultModel
}

func pickOpenAIMaxTokens(n int) int {
	if n > 0 {
		return n
	}
	return openAIDefaultMaxTok
}

// toOpenAIMessages —— 把 cross-provider Message 转 OpenAI msg；system
// 在 OpenAI 是普通 message (role=system)，跟 Anthropic 不一样。
func toOpenAIMessages(system string, in []Message) []oaMsg {
	out := make([]oaMsg, 0, len(in)+1)
	if system != "" {
		out = append(out, oaMsg{Role: openAIRoleSystem, Content: system})
	}
	for i := range in {
		if in[i].Role == openAIRoleSystem {
			continue // 已经在前面塞过
		}
		out = append(out, oaMsg{Role: in[i].Role, Content: in[i].Content})
	}
	return out
}

// translateOpenAIStatus —— 翻 4xx/5xx 到 sentinel。复用 statusSentinel
// 那张表（401/403/429/402/503），400 走 classifyOpenAI400 词典，404 当
// model not found，5xx → ServerSide。
func translateOpenAIStatus(resp *http.Response) error {
	defer closeBody(resp.Body)
	bodyText, rerr := io.ReadAll(resp.Body)
	if rerr != nil {
		bodyText = []byte("(read body err)")
	}
	if sentinel := statusSentinel(resp.StatusCode); sentinel != nil {
		return sentinel
	}
	return classifyOpenAIStatusFromBody(resp.StatusCode, string(bodyText))
}

// classifyOpenAIStatusFromBody —— statusSentinel 没接住的 4xx/5xx 继续
// 细分。拆出来让 translateOpenAIStatus 守 cyclop ≤ 5。
func classifyOpenAIStatusFromBody(code int, body string) error {
	if code == http.StatusBadRequest {
		return classifyOpenAI400(body)
	}
	if code == http.StatusNotFound {
		// /v1/chat/completions 不存在 → model 名或 base URL 错。
		return ErrModelNotFound
	}
	if code >= httpServerErrorBoundary {
		return ErrServerSide
	}
	return fmt.Errorf("openai %d: %s", code, body)
}

func classifyOpenAI400(body string) error {
	lower := strings.ToLower(body)
	switch {
	case strings.Contains(lower, "context_length_exceeded"),
		strings.Contains(lower, "maximum context"),
		strings.Contains(lower, "too long"):
		return ErrContextTooLong
	case strings.Contains(lower, "content_policy"),
		strings.Contains(lower, "content policy"),
		strings.Contains(lower, "safety"):
		return ErrContentPolicy
	case strings.Contains(lower, "model"),
		strings.Contains(lower, "model_not_found"):
		return ErrModelNotFound
	}
	return errors.New("openai 400: " + body)
}
