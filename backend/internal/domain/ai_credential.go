// ai_credential.go —— inference 的 provider+key 抽象。
//
// 同一个 struct 形态覆盖两条 path：
//
//  1. visitor BYOAI：route layer 从 X-BYOAI-Provider + X-BYOAI-Key headers
//     信封解封得到 → 直接构造一份 AICredential 喂给 resolver。
//  2. owner 自己配的 provider：postgres.OwnerRepo 从 owners.ai_provider +
//     ai_provider_key_enc 读 + cryptobox.Decrypt → 同一份 AICredential 形态。
//
// request-scoped value object。**plaintext** key 字段；server 任何持久层
// 都不直接存这个 struct（owner side 持久态是密文 ai_provider_key_enc，
// visitor side 根本不在 server 存）。

package domain

// AICredential —— 一个 inference provider 实例化所需的最小元组：
// 名字（'anthropic' / 'openai' / ...）+ plaintext API key。
type AICredential struct {
	Provider string
	Key      string
}

// HasKey —— 非空判断。空 cred 让 resolver 走 fallback（owner 默认 / 报错）。
func (c *AICredential) HasKey() bool {
	return c != nil && c.Key != ""
}
