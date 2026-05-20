// ai_provider.go —— owner 切换 / 配置自己的 AI provider 的 usecase。
//
// 校验 provider 合法 + 跟 repo 通信；明文 key 不写入 log，只透传给 repo
// 走 AES-GCM 加密。

package usecases

import (
	"context"
	"fmt"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres"
)

// AIProviderDeps —— UpdateOwnerAIProvider 依赖。
type AIProviderDeps struct {
	Owners *postgres.OwnerRepo
}

// UpdateOwnerAIProviderInput —— 入参。
//   - Provider:  "mock" / "anthropic" / "openai"
//   - KeyChange: KeyKeep（不动）/ KeySet（设新 key）/ KeyClear（删 key）
//   - Key:       当 KeyChange=KeySet 时给明文 key；其它情况忽略
type UpdateOwnerAIProviderInput struct {
	OwnerID   string
	Provider  string
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

// validProviders —— owner-facing 选项；mock 是 e2e fixture，不在这。
var validProviders = map[string]struct{}{
	"anthropic": {}, "openai": {},
}

// UpdateOwnerAIProvider —— 调 repo 落库。返回新 owner profile（不含明文 key）。
func UpdateOwnerAIProvider(
	ctx context.Context, deps AIProviderDeps, in *UpdateOwnerAIProviderInput,
) (domain.Owner, error) {
	if _, ok := validProviders[in.Provider]; !ok {
		return domain.Owner{}, fmt.Errorf(
			"%w: provider must be anthropic | openai", ErrEmptyField,
		)
	}
	owner, err := deps.Owners.UpdateAIProvider(ctx, &postgres.UpdateAIProviderInput{
		OwnerID:      in.OwnerID,
		Provider:     in.Provider,
		KeyPlaintext: resolveKeyArg(in.KeyChange, in.Key),
	})
	if err != nil {
		return domain.Owner{}, fmt.Errorf("update ai provider: %w", err)
	}
	return owner, nil
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
