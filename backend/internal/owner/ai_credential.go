// ai_credential.go —— inference 的 provider+key 抽象。
//
// 同一个 struct 形态覆盖两条 path：
//
//  1. visitor BYOAI：route layer 从 X-BYOAI-Provider + X-BYOAI-Key headers
//     信封解封得到 → 直接构造一份 AICredential 喂给 resolver。
//  2. owner 自己配的 provider：owner.Repo 从 owners.ai_provider +
//     ai_provider_key_enc 读 + cryptobox.Decrypt → 同一份 AICredential 形态。
//
// request-scoped value object。**plaintext** key 字段；server 任何持久层
// 都不直接存这个 struct（owner side 持久态是密文 ai_provider_key_enc，
// visitor side 根本不在 server 存）。

package owner

// AICredential —— 一个 inference provider 实例化所需的元组。
//
//   - Provider 名字（'anthropic' / 'openai' / 'deepseek' / 'kimi' / 'groq' /
//     'siliconflow' / 'openrouter' / 'together' / 'custom' / ...）
//   - Key plaintext API key
//   - Model 可选，空 → 走 provider preset 默认 model
//   - Endpoint 可选，空 → 走 provider preset 默认 base URL；只对
//     openai-compat 协议 + provider='custom' 有意义（owner 自托管 ollama /
//     vllm / lm-studio 等 OpenAI 兼容 server）
type AICredential struct {
	Provider string
	Key      string
	Model    string
	Endpoint string
}

// HasKey —— 非空判断。空 cred 让 resolver 走 fallback（owner 默认 / 报错）。
func (c *AICredential) HasKey() bool {
	return c != nil && c.Key != ""
}
