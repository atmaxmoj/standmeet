// ai_provider.go —— owner 切换 / 配置自己的 AI provider 的 usecase。
//
// 校验 provider 合法 + 跟 repo 通信；明文 key 不写入 log，只透传给 repo
// 走 AES-GCM 加密。

package owner

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

// AIProviderDeps —— UpdateOwnerAIProvider 依赖。
type AIProviderDeps struct {
	Owners    *Repo
	Providers ProviderValidator
}

// ProviderValidator —— 校验 provider 名是否是已知 preset 的窄口。owner 不反依赖
// inference(inference→owner 会成环);composition root 用 inference.Lookup 适配进来。
type ProviderValidator interface {
	Known(provider string) bool
}

// UpdateOwnerAIProviderInput —— 入参。
//   - Provider:  preset 表里任意 Name（anthropic / openai / deepseek / kimi /
//     groq / siliconflow / openrouter / together / custom），server 校验。
//   - Endpoint:  base URL（不带 /v1/...）。frontend 选 provider 时用 preset
//     默认预填；custom 必须 owner 自填。**必须非空**。
//   - Model:     model id。frontend 同样 preset 预填；owner 可改。**必须非空**。
//   - KeyChange: KeyKeep（不动）/ KeySet（设新 key）/ KeyClear（删 key）
//   - Key:       当 KeyChange=KeySet 时给明文 key；其它情况忽略
type UpdateOwnerAIProviderInput struct {
	OwnerID   string
	Provider  string
	Endpoint  string
	Model     string
	Key       string
	KeyChange KeyChange
}

// KeyChange —— 三态枚举，对应"保持不动 / 设新 key / 清空 key"。
type KeyChange int

// KeyKeep / KeySet / KeyClear 是 KeyChange 的三个值。
const (
	KeyKeep KeyChange = iota
	KeySet
	KeyClear
)

// UpdateOwnerAIProvider —— 调 repo 落库。返回新 OwnerSettings（不含明文 key）。
// 校验：provider 必须在 inference preset 表里；endpoint + model 必须非空
// （preset 给 UI 默认填值，server 端不做 fallback，避免 DB 落部分 row）。
func UpdateOwnerAIProvider(
	ctx context.Context, deps AIProviderDeps, in *UpdateOwnerAIProviderInput,
) (Settings, error) {
	if verr := validateAIProviderInput(deps.Providers, in); verr != nil {
		return Settings{}, verr
	}
	s, err := deps.Owners.UpdateAIProvider(ctx, &UpdateAIProviderInput{
		OwnerID:      in.OwnerID,
		Provider:     in.Provider,
		Endpoint:     in.Endpoint,
		Model:        in.Model,
		KeyPlaintext: resolveKeyArg(in.KeyChange, in.Key),
	})
	if err != nil {
		return Settings{}, fmt.Errorf("update ai provider: %w", err)
	}
	return s, nil
}

func validateAIProviderInput(providers ProviderValidator, in *UpdateOwnerAIProviderInput) error {
	if !providers.Known(in.Provider) {
		return fmt.Errorf("%w: unknown provider %q", apierr.ErrEmptyField, in.Provider)
	}
	if in.Endpoint == "" || in.Model == "" {
		return fmt.Errorf("%w: endpoint + model required", apierr.ErrEmptyField)
	}
	return nil
}

func resolveKeyArg(kc KeyChange, key string) *string {
	switch kc {
	case KeySet:
		k := key
		return &k
	case KeyClear:
		empty := ""
		return &empty
	case KeyKeep:
		return nil
	}
	return nil
}
