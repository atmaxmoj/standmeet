// owner_lookup.go —— resolver 从 postgres 取 owner key 的窄契约。
// resolver.go 拿这个 contract 解算 Provider；contract 跟实现拆开，让
// owner aggregate 的接口形状跟 provider 选择策略各自有自己的文件。

package inference

import "context"

// OwnerKeyView —— resolver 需要从 owner repo 拿到的最小信息。
// Endpoint / Model 仅 provider='custom' 必填（自托管 OpenAI-compat
// server）或 owner 显式覆盖了 preset 默认时非空；其它情况留空，resolver
// 用 preset 默认。
type OwnerKeyView struct {
	Provider string // 'anthropic' / 'openai' / 'deepseek' / ... / 'custom'
	Endpoint string // openai-compat base URL；空 = 用 preset 默认
	Model    string // 默认 model；空 = 用 preset 默认
	KeyEnc   []byte // AES-GCM 加密；空 byte slice = 未设
}

// OwnerLookup —— resolver 注入的窄接口，避免 import postgres。
type OwnerLookup interface {
	LookupForResolver(ctx context.Context, ownerID string) (OwnerKeyView, error)
}

// KeyDecrypter —— 抽掉 cryptobox 依赖，让测试可以注 stub。dev/prod 默认就是
// cryptobox.Decrypt。
type KeyDecrypter func(enc []byte) ([]byte, error)
