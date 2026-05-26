// resolver.go —— per-owner / per-byoai-visitor provider 解算。
//
// visitor chat 不能直接 import postgres（avoid cycle），所以 resolver 取一个
// 窄接口 `OwnerLookup`，调用方注入。
//
// 输入是 `domain.AICredential` —— 一个 (provider, plaintext key) 元组。
// visitor BYOAI 跟 owner 自己配的 provider 形态相同，都喂这个 struct 进
// resolver。BYOAI 路径 cred 由 route layer 从 request header 信封解出来；
// owner 路径 cred 由 OwnerKeyResolver 从 DB 密文解出来。
//
// 策略：
//   1. ENV INFERENCE_PROVIDER=mock 时（e2e / dev fixture）：所有 tier 都用
//      MockProvider。
//   2. 否则：tier='byoai' + 非空 BYOAI cred → 直接实例化（visitor 自己付）。
//   3. 其他 → OwnerKeyResolver 走 owner row。
//   4. owner.ai_provider_key_enc 空 → ErrOwnerProviderUnconfigured。

package inference

import (
	"context"
	"errors"
	"fmt"
	"os"

	"github.com/wangsijie/standmeet/internal/domain"
)

// ErrOwnerProviderUnconfigured —— owner 还没配 ai_provider_key。访客 chat
// 在这种情况要走 friendly fallback（前端 toast "owner hasn't connected AI yet"）。
var ErrOwnerProviderUnconfigured = errors.New("owner AI provider not configured")

// ResolveInput —— resolver 入参。BYOAI 字段仅 tier='byoai' 时非 nil；其它
// tier 走 owner key。fieldalignment: pointer 先，string 后。
type ResolveInput struct {
	BYOAI   *domain.AICredential
	OwnerID string
	Tier    string
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
	if in.Tier == "byoai" && in.BYOAI.HasKey() {
		return buildFromCred(in.BYOAI)
	}
	p, err := r.Owner.Resolve(ctx, in)
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
func (r *OwnerKeyResolver) Resolve(ctx context.Context, in *ResolveInput) (Provider, error) {
	cred, err := r.loadOwnerCred(ctx, in.OwnerID)
	if err != nil {
		return nil, err
	}
	return buildFromCred(&cred)
}

func (r *OwnerKeyResolver) loadOwnerCred(
	ctx context.Context, ownerID string,
) (domain.AICredential, error) {
	view, err := r.Lookup.LookupForResolver(ctx, ownerID)
	if err != nil {
		return domain.AICredential{}, fmt.Errorf("resolve owner provider: %w", err)
	}
	if len(view.KeyEnc) == 0 {
		return domain.AICredential{}, ErrOwnerProviderUnconfigured
	}
	keyBytes, derr := r.Decrypter(view.KeyEnc)
	if derr != nil {
		return domain.AICredential{}, fmt.Errorf("decrypt owner ai key: %w", derr)
	}
	return domain.AICredential{Provider: view.Provider, Key: string(keyBytes)}, nil
}

// ErrOpenAINotImplemented —— openai provider 占位；点 openai 选项时报这条。
var ErrOpenAINotImplemented = errors.New("openai provider not implemented yet")

// buildFromCred —— 单一构造点，byoai / owner 两条 path 都通过这里实例化
// Provider。多 provider 扩展（gemini / mistral / 自托管 LLM）加一行 case 即可。
func buildFromCred(cred *domain.AICredential) (Provider, error) {
	switch cred.Provider {
	case "anthropic":
		return NewAnthropic(AnthropicConfig{APIKey: cred.Key}), nil
	case "openai":
		return nil, ErrOpenAINotImplemented
	default:
		return nil, fmt.Errorf("unknown provider %q", cred.Provider)
	}
}
