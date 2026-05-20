// owner_lookup.go —— resolver 从 postgres 取 owner key 的窄契约。
// resolver.go 拿这个 contract 解算 Provider；contract 跟实现拆开，让
// owner aggregate 的接口形状跟 provider 选择策略各自有自己的文件。

package inference

import "context"

// OwnerKeyView —— resolver 需要从 owner repo 拿到的最小信息。
type OwnerKeyView struct {
	Provider string // 'anthropic' | 'openai'
	KeyEnc   []byte // AES-GCM 加密；空 byte slice = 未设
}

// OwnerLookup —— resolver 注入的窄接口，避免 import postgres。
type OwnerLookup interface {
	LookupForResolver(ctx context.Context, ownerID string) (OwnerKeyView, error)
}

// KeyDecrypter —— 抽掉 cryptobox 依赖，让测试可以注 stub。dev/prod 默认就是
// cryptobox.Decrypt。
type KeyDecrypter func(enc []byte) ([]byte, error)
