// Package inference —— LLM 调用层。统一走 cloudwego/eino 的
// model.ToolCallingChatModel 抽象；provider (anthropic / openai-
// compat / gemini / ollama) 由 Cred.Provider 选 adapter。两个调用
// 形态：
//
//   - Stream (proxy.go)   —— 流式 SSE，给浏览器 pi-agent-core 跑
//     chat agent loop
//   - Generate (generate.go) —— 一次性返 text，给 visitor_summary
//     / 未来 capability 复用
//
// Cred + Resolver 在 resolver.go；errors.go 是 sentinel + 状态分类。
//
// eino_model.go —— 按 owner / visitor BYOAI cred 构造一个
// eino model.ToolCallingChatModel。背后选 provider-specific adapter
// (claude / openai / openai-compat via baseURL override)，对调用方
// 暴露统一 ChatModel 接口。
//
// 不缓存 model 实例 —— 每个 chat 请求构造一次，构造代价低 (只是
// 装 HTTP client + 配置)，省去 cache 失效跟 owner 改 cred 后清空
// 的复杂度。
package inference

import (
	"context"
	"errors"
	"fmt"

	"github.com/cloudwego/eino-ext/components/model/claude"
	"github.com/cloudwego/eino-ext/components/model/openai"
	"github.com/cloudwego/eino/components/model"

	"github.com/atmaxmoj/standmeet/internal/httpx"
)

const (
	// defaultMaxTokens —— 单次回复的输出上限。1024 会把几百词的实质回答从句子
	// 中间截断（eval 面试里每条答案都被切）。4096 给完整 chat 回答足够余量，
	// 又不至于让单 turn 成本失控。
	defaultMaxTokens = 4096
	providerOpenAI   = "openai"
	providerAnthrop  = "anthropic"
)

// BuildChatModel —— 按 cred 选具体 adapter。anthropic 走自家
// Messages API；其它 provider (deepseek / kimi / groq / together /
// openrouter / siliconflow / custom self-host) 全走 openai-compat
// /v1/chat/completions API，BaseURL 由 cred.Endpoint 决定。
//
//nolint:ireturn // dispatch by provider; caller 持 model.ToolCallingChatModel interface
func BuildChatModel(ctx context.Context, cred *Cred) (model.ToolCallingChatModel, error) {
	if err := checkCredBasics(cred); err != nil {
		return nil, err
	}
	if verr := validateUntrustedEndpoint(ctx, cred); verr != nil {
		return nil, verr
	}
	if cred.Provider == providerAnthrop {
		return buildClaudeModel(ctx, cred)
	}
	if _, known := Lookup(cred.Provider); !known {
		return nil, fmt.Errorf("eino: unknown provider %q", cred.Provider)
	}
	return buildOpenAICompatModel(ctx, cred)
}

func checkCredBasics(cred *Cred) error {
	if cred == nil {
		return errors.New("eino: cred required")
	}
	if cred.Model == "" {
		return errors.New("eino: cred.Model required")
	}
	return nil
}

// validateUntrustedEndpoint —— an Untrusted (BYOAI) endpoint is visitor-controlled → refuse an
// internal/private target before any dial (SSRF). Wraps httpx.ErrBlockedEgress so ClassifyStreamErr
// names the address policy. Owner creds (trusted self-host config) are not checked.
func validateUntrustedEndpoint(ctx context.Context, cred *Cred) error {
	if !cred.Untrusted || cred.Endpoint == "" {
		return nil
	}
	if verr := httpx.ValidatePublicURL(ctx, cred.Endpoint); verr != nil {
		return fmt.Errorf("eino: byoai endpoint: %w", verr)
	}
	return nil
}

//nolint:ireturn // dispatch helper returns the interface BuildChatModel exposes
func buildClaudeModel(ctx context.Context, cred *Cred) (model.ToolCallingChatModel, error) {
	cfg := &claude.Config{
		APIKey:    cred.Key,
		Model:     cred.Model,
		MaxTokens: defaultMaxTokens,
	}
	if cred.Endpoint != "" {
		ep := cred.Endpoint
		cfg.BaseURL = &ep
	}
	cm, err := claude.NewChatModel(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("eino: claude model: %w", err)
	}
	return cm, nil
}

//nolint:ireturn // dispatch helper returns the interface BuildChatModel exposes
func buildOpenAICompatModel(ctx context.Context, cred *Cred) (model.ToolCallingChatModel, error) {
	maxTok := defaultMaxTokens
	cfg := &openai.ChatModelConfig{
		APIKey:    cred.Key,
		Model:     cred.Model,
		MaxTokens: &maxTok,
		// 重试 transport:transient(连接错 / 429 / 5xx)在响应头到达前自动重试,
		// 不重试 ctx 取消、不重读已 stream 的 token。见 http_retry.go。untrusted(BYOAI)
		// endpoint → 装 SSRF 守卫 dialer(DNS-rebind 也拦)。
		HTTPClient: retryHTTPClient(cred.Untrusted),
	}
	if cred.Endpoint != "" {
		cfg.BaseURL = cred.Endpoint
	}
	cm, err := openai.NewChatModel(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("eino: openai-compat model: %w", err)
	}
	return cm, nil
}
