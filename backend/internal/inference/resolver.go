// resolver.go —— per-owner provider 解算。
//
// visitor chat 不能直接 import postgres（avoid cycle），所以 resolver 取一个
// 窄接口 `OwnerLookup`，调用方注入。
//
// 策略：
//   1. ENV INFERENCE_PROVIDER=mock 时（e2e / dev fixture）：所有 owner 都用
//      MockProvider。owner.ai_provider 列被忽略——mock 不是 owner 选项。
//   2. 否则：按 owner row 拿 provider + 解 key，实例化对应 provider。
//   3. owner.ai_provider_key_enc 空（未配置）→ ErrOwnerProviderUnconfigured。

package inference

import (
	"context"
	"errors"
	"fmt"
	"os"
)

// ErrOwnerProviderUnconfigured —— owner 还没配 ai_provider_key。访客 chat
// 在这种情况要走 friendly fallback（前端 toast "owner hasn't connected AI yet"）。
var ErrOwnerProviderUnconfigured = errors.New("owner AI provider not configured")

// Resolver —— 业务调用点：传 ownerID，拿 Provider。
type Resolver interface {
	Resolve(ctx context.Context, ownerID string) (Provider, error)
}

// EnvOrOwnerResolver —— ENV=mock 走 mock；否则 delegate 到 owner-key 实现。
type EnvOrOwnerResolver struct {
	Mock      *MockProvider
	Owner     Resolver
	EnvIsMock bool
}

// NewEnvOrOwnerResolver —— 工厂；env 见 NewFromEnv 同一规则。
func NewEnvOrOwnerResolver(ownerResolver Resolver, mock *MockProvider) *EnvOrOwnerResolver {
	return &EnvOrOwnerResolver{
		Mock: mock, Owner: ownerResolver,
		EnvIsMock: os.Getenv("INFERENCE_PROVIDER") == "mock",
	}
}

// Resolve 实现 Resolver 接口。
func (r *EnvOrOwnerResolver) Resolve(ctx context.Context, ownerID string) (Provider, error) {
	if r.EnvIsMock {
		return r.Mock, nil
	}
	p, err := r.Owner.Resolve(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("owner resolver: %w", err)
	}
	return p, nil
}

// OwnerKeyResolver —— 真正按 owner row 解算。
type OwnerKeyResolver struct {
	Lookup    OwnerLookup
	Decrypter KeyDecrypter
}

// Resolve 实现 Resolver 接口。
func (r *OwnerKeyResolver) Resolve(ctx context.Context, ownerID string) (Provider, error) {
	view, err := r.Lookup.LookupForResolver(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("resolve owner provider: %w", err)
	}
	if len(view.KeyEnc) == 0 {
		return nil, ErrOwnerProviderUnconfigured
	}
	keyBytes, derr := r.Decrypter(view.KeyEnc)
	if derr != nil {
		return nil, fmt.Errorf("decrypt owner ai key: %w", derr)
	}
	return buildProvider(view.Provider, string(keyBytes))
}

// ErrOpenAINotImplemented —— openai provider 占位；点 openai 选项时报这条。
var ErrOpenAINotImplemented = errors.New("openai provider not implemented yet")

func buildProvider(provider, key string) (Provider, error) {
	switch provider {
	case "anthropic":
		return NewAnthropic(AnthropicConfig{APIKey: key}), nil
	case "openai":
		return nil, ErrOpenAINotImplemented
	default:
		return nil, fmt.Errorf("unknown provider %q", provider)
	}
}
