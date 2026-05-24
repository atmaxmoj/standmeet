// resolver.go —— per-owner / per-byoai-visitor provider 解算。
//
// visitor chat 不能直接 import postgres（avoid cycle），所以 resolver 取一个
// 窄接口 `OwnerLookup`，调用方注入。
//
// 策略：
//   1. ENV INFERENCE_PROVIDER=mock 时（e2e / dev fixture）：所有 tier 都用
//      MockProvider。owner.ai_provider 列 + byoai key 都被忽略 —— mock 不
//      区分调用方。
//   2. 否则：tier='byoai' + 非空 BYOAIKeyEnc → 用 cryptobox 解密，按
//      BYOAIProvider 名实例化（visitor 自己付推理费）。
//   3. 其他 → 按 owner row 的 ai_provider + ai_provider_key_enc 实例化。
//   4. owner.ai_provider_key_enc 空（未配置）→ ErrOwnerProviderUnconfigured。

package inference

import (
	"context"
	"errors"
	"fmt"
	"os"

	"github.com/wangsijie/standmeet/internal/cryptobox"
)

// ErrOwnerProviderUnconfigured —— owner 还没配 ai_provider_key。访客 chat
// 在这种情况要走 friendly fallback（前端 toast "owner hasn't connected AI yet"）。
var ErrOwnerProviderUnconfigured = errors.New("owner AI provider not configured")

// ResolveInput —— resolver 入参。BYOAI 字段仅 tier='byoai' 时有意义。
type ResolveInput struct {
	OwnerID       string
	Tier          string
	BYOAIProvider string
	BYOAIKeyEnc   []byte
}

// Resolver —— 业务调用点：传 ownerID + 可选 byoai 信息，拿 Provider。
type Resolver interface {
	Resolve(ctx context.Context, in *ResolveInput) (Provider, error)
}

// EnvOrOwnerResolver —— ENV=mock 走 mock；否则按 tier 分支：byoai 用 visitor
// 自带 key，其他走 owner key。
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
func (r *EnvOrOwnerResolver) Resolve(
	ctx context.Context, in *ResolveInput,
) (Provider, error) {
	if r.EnvIsMock {
		return r.Mock, nil
	}
	if in.Tier == "byoai" && len(in.BYOAIKeyEnc) > 0 {
		return buildBYOAIProvider(in.BYOAIProvider, in.BYOAIKeyEnc)
	}
	p, err := r.Owner.Resolve(ctx, in)
	if err != nil {
		return nil, fmt.Errorf("owner resolver: %w", err)
	}
	return p, nil
}

// buildBYOAIProvider —— 解密 visitor 提交的 key，按 provider 名实例化。
// 不依赖 owner 配置 —— visitor 自带 key 应当能用 owner 没配过的 provider。
func buildBYOAIProvider(provider string, keyEnc []byte) (Provider, error) {
	plain, derr := cryptobox.Decrypt(keyEnc)
	if derr != nil {
		return nil, fmt.Errorf("decrypt byoai key: %w", derr)
	}
	return buildProvider(provider, string(plain))
}

// OwnerKeyResolver —— 真正按 owner row 解算。
type OwnerKeyResolver struct {
	Lookup    OwnerLookup
	Decrypter KeyDecrypter
}

// Resolve 实现 Resolver 接口。
func (r *OwnerKeyResolver) Resolve(ctx context.Context, in *ResolveInput) (Provider, error) {
	view, err := r.Lookup.LookupForResolver(ctx, in.OwnerID)
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
