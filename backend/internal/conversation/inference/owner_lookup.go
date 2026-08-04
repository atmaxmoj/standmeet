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

// KeyDecrypter —— 抽掉 cryptobox 依赖，让测试可以注 stub。dev/prod 默认包一层 cryptobox.Decrypt。
// ownerID 作 AAD:owner LLM key 密文绑到该 owner，被搬到别的 owner 行时解密 tamper-fail。
//
// **这是内核唯一一处解封,而且它是一条已声明的例外,不是既成事实。**
//
// §1.5 是"内核只封、永不解封" —— 解封归持有那份密文列并且当场花掉它的那一层(连接器那边
// 就是这么做的:密文在读到行的地方解开,明文不出那一层)。内核不是这样的一层:它没有凭据存储,
// 所以这里等于把"密文 + 打开它的东西"一起交给了一段两样都不该管的代码。
//
// 例外由 infra/scripts/check-core-seals-only.sh 看着,四行都记在
// backend/.core-seals-only-baseline 里,那个基线只能缩。排掉它要先定一件事:AI provider
// 到底做成一个连接器(内核连 key 都不该看见,拿到的是一个能调的东西),还是就让拥有
// owners.ai_provider_key_enc 那张表的 repo 去解。**这个决定还没做**,所以它现在是被点了名的
// 例外 —— 而不是一处没人看见的解封。
type KeyDecrypter func(ownerID string, enc []byte) ([]byte, error)
