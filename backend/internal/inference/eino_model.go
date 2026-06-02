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
)

const (
	defaultMaxTokens = 1024
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
	if cred == nil {
		return nil, errors.New("eino: cred required")
	}
	if cred.Model == "" {
		return nil, errors.New("eino: cred.Model required")
	}
	if cred.Provider == providerAnthrop {
		return buildClaudeModel(ctx, cred)
	}
	if _, known := Lookup(cred.Provider); !known {
		return nil, fmt.Errorf("eino: unknown provider %q", cred.Provider)
	}
	return buildOpenAICompatModel(ctx, cred)
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
