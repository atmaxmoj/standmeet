// owner_lookup.go —— resolver 从 postgres 取 owner key 的窄契约。
// resolver.go 拿这个 contract 解算 Provider；contract 跟实现拆开，让
// owner aggregate 的接口形状跟 provider 选择策略各自有自己的文件。

package inference

import "context"

// OwnerKeyView —— resolver 需要从 owner repo 拿到的最小信息。
// Endpoint / Model 仅 provider='custom' 必填（自托管 OpenAI-compat
// server）或 owner 显式覆盖了 preset 默认时非空；其它情况留空，resolver
// 用 preset 默认。
//
// Key 是**已经开好的**明文,不是密文。§1.5:内侧只封,不解 —— 所以这里既不收密文,
// 也不收一个"能解封的东西"。开封发生在组装那一侧,内核拿到的是一份能用的凭据,
// 不是打开它的钥匙。(以前这里是 `KeyEnc []byte` + 一个注进来的 KeyDecrypter:
// 那等于把密文和万能开封器一起交给了一段两样都不该管的代码。).
type OwnerKeyView struct {
	Provider string // 'anthropic' / 'openai' / 'deepseek' / ... / 'custom'
	Endpoint string // openai-compat base URL；空 = 用 preset 默认
	Model    string // 默认 model；空 = 用 preset 默认
	Key      string // 明文 API key；空 = owner 没配
}

// OwnerLookup —— resolver 注入的窄接口，避免 import postgres。
//
// providerID —— 这一场会话要用**哪一条** provider(owner 手上是一本,不是一份)。空 = 用默认。
// 谁压过谁(码 > role > 默认)在发会话时就评估完了、冻进 session —— 内核只知道"用这一条",
// 不知道它是从码上还是 role 上来的,更不知道有"码"这么个东西。
type OwnerLookup interface {
	LookupForResolver(
		ctx context.Context, ownerID, providerID string,
	) (OwnerKeyView, error)
}

// 这里以前有一个 `KeyDecrypter func(ownerID string, enc []byte) ([]byte, error)` ——
// 组装根注一个 cryptobox.Decrypt 闭包进来,内核自己开 owners.ai_provider_key_enc。
// 它已经删了:内核持有的不该是"能开封的东西",而 KeyDecrypter 是一把对**任意 owner**
// 都好使的万能钥匙。开封现在只发生在组装那一侧(见 cmd/server 的 ownerLookupAdapter),
// 内核收到的是 OwnerKeyView.Key —— 一份能用的凭据。
//
// 这条不变量由 infra/scripts/check-core-seals-only.sh 看着。
