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

	"github.com/atmaxmoj/standmeet/internal/infra/httpx"
)

const (
	// defaultMaxTokens —— 单次回复的输出上限。1024 会把几百词的实质回答从句子
	// 中间截断（eval 面试里每条答案都被切）。4096 给完整 chat 回答足够余量，
	// 又不至于让单 turn 成本失控。
	defaultMaxTokens = 4096
	providerOpenAI   = "openai"
	providerAnthrop  = "anthropic"
)

// BoundaryMaxTokens —— 边界那一次合成（forceFinalAnswer）自己的输出预算。
//
// **为什么它不能用默认那个 4096**：prod 上驱 F-A-40 的 ⑤ 时量到的 —— 边界确实点着了
// （`forcing synthesis from evidence evidence_items:24`），40 秒之后回来的却是**空串、
// 没有报错**，于是那一轮照旧 `answer_chars:0`。owner 这台用的是 reasoning 模型
// （deepseek-v4-pro），思考 token 跟正文共用同一个输出预算：让它把二十多条证据合成成
// 一段话，4096 全花在思考上，content 一个字都没剩。
//
// 这正是这条缺陷自己的道理**又发生了一遍**：任何预算都会被耗尽，所以救场的那一步
// 不能跟它要救的那一步共用同一个额度。边界给自己一份更大的。
const BoundaryMaxTokens = 12288

// BuildChatModel —— 按 cred 选具体 adapter。anthropic 走自家
// Messages API；其它 provider (deepseek / kimi / groq / together /
// openrouter / siliconflow / custom self-host) 全走 openai-compat
// /v1/chat/completions API，BaseURL 由 cred.Endpoint 决定。
//
//nolint:ireturn // dispatch by provider; caller 持 model.ToolCallingChatModel interface
func BuildChatModel(ctx context.Context, cred *Cred) (model.ToolCallingChatModel, error) {
	return BuildChatModelBudgeted(ctx, cred, 0)
}

// BuildChatModelBudgeted —— 同上，但调用方可以指定这一次的输出预算（0 = 用默认）。
// 只有边界那次合成需要它（见 BoundaryMaxTokens）：其余每一处都该用同一个默认值，
// 不然「一次回答能有多长」就变成散落各处的常数了。
//
//nolint:ireturn // dispatch by provider; caller 持 model.ToolCallingChatModel interface
func BuildChatModelBudgeted(
	ctx context.Context, cred *Cred, maxTokens int,
) (model.ToolCallingChatModel, error) {
	if err := checkCredBasics(cred); err != nil {
		return nil, err
	}
	if verr := validateUntrustedEndpoint(ctx, cred); verr != nil {
		return nil, verr
	}
	tok := outputBudget(maxTokens)
	if cred.Provider == providerAnthrop {
		return buildClaudeModel(ctx, cred, tok)
	}
	if _, known := Lookup(cred.Provider); !known {
		return nil, fmt.Errorf("eino: unknown provider %q", cred.Provider)
	}
	return buildOpenAICompatModel(ctx, cred, tok)
}

// outputBudget —— 调用方给了就用它，没给就用默认。「一次回答能有多长」只在这里定一次。
func outputBudget(requested int) int {
	if requested > 0 {
		return requested
	}
	return defaultMaxTokens
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
func buildClaudeModel(
	ctx context.Context, cred *Cred, maxTok int,
) (model.ToolCallingChatModel, error) {
	cfg := &claude.Config{
		APIKey:    cred.Key,
		Model:     cred.Model,
		MaxTokens: maxTok,
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
func buildOpenAICompatModel(
	ctx context.Context, cred *Cred, maxTok int,
) (model.ToolCallingChatModel, error) {
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
