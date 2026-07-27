// presets.go —— inference provider preset 表（UI endpoint 默认 + 列表 +
// key prefix 校验提示）。
//
// **故意没有 default model 字段**：owner / visitor 必须自己输 model（防止
// 因为默认指过时 / 错误模型而不自知）。UI 上 "Load models" button 调
// /api/v1/inference/models 拉真实可用列表帮选；不点就保留 text input 让
// 用户手输。
//
// **Server 侧用途**：UpdateOwnerAIProviderInput / X-BYOAI-* headers 校验
// provider name 在 preset 里 + endpoint + model 都非空（caller 必须补全）。
//
// **Frontend 侧用途**：All() 给 admin AIProviderPanel + visitor BYOAIPanel
// 列下拉 + 选某项时自动填 endpoint 默认值。model 字段始终空让用户输。
//
// 注意：所有 BaseURL **不带** `/v1/...` 路径（adapter 内部拼）。custom
// 的 BaseURL 留空，owner 自托管时自己填完整 base（e.g., http://localhost:11434）。

package inference

import "slices"

// ProviderPreset —— 一个 inference provider 的元信息。
//
// fieldalignment: 全 string 字段，按字母序就行。
type ProviderPreset struct {
	BaseURL   string // /v1/chat/completions 的根（不含路径）
	KeyPrefix string // sanity check（"sk-" / "gsk_" / …）；空表跳过校验
	Label     string // UI 显示名
	Name      string // canonical 小写 id ('openai' / 'deepseek' / …)
}

// presetTable —— 所有内置 preset 的真源。新增 provider 只动这里。
//
// `anthropic` 在表里 (UI 一处统一下拉) 但 server resolver 会走
// anthropic.go 单独适配器（Messages API 不兼容 OpenAI Chat Completions）。
// custom 是自托管 (ollama / vllm / lm-studio)，BaseURL 留空让 owner 自填。
var presetTable = map[string]ProviderPreset{
	"anthropic": {
		Name: "anthropic", Label: "Anthropic Claude",
		BaseURL: "https://api.anthropic.com", KeyPrefix: "sk-ant-",
	},
	"openai": {
		Name: "openai", Label: "OpenAI",
		BaseURL: "https://api.openai.com", KeyPrefix: "sk-",
	},
	"deepseek": {
		Name: "deepseek", Label: "DeepSeek",
		BaseURL: "https://api.deepseek.com", KeyPrefix: "sk-",
	},
	"kimi": {
		Name: "kimi", Label: "Kimi (Moonshot)",
		BaseURL: "https://api.moonshot.cn", KeyPrefix: "sk-",
	},
	"groq": {
		Name: "groq", Label: "Groq",
		BaseURL: "https://api.groq.com/openai", KeyPrefix: "gsk_",
	},
	"siliconflow": {
		Name: "siliconflow", Label: "SiliconFlow",
		BaseURL: "https://api.siliconflow.cn", KeyPrefix: "sk-",
	},
	"openrouter": {
		Name: "openrouter", Label: "OpenRouter",
		BaseURL: "https://openrouter.ai/api", KeyPrefix: "sk-or-",
	},
	"together": {
		Name: "together", Label: "Together AI",
		BaseURL: "https://api.together.xyz", KeyPrefix: "",
	},
	"custom": {
		Name: "custom", Label: "Custom (self-hosted: ollama / vllm / lm-studio)",
		BaseURL: "", KeyPrefix: "",
	},
}

// Lookup —— provider 名 → preset。未知 provider 返 zero + false。
func Lookup(name string) (ProviderPreset, bool) {
	p, ok := presetTable[name]
	return p, ok
}

// All —— 全部 preset 列表，按 Name 字典序。frontend / admin UI 列下拉
// 直接消费这个；调用方读 BaseURL=="" 判断是不是 custom 需要 owner 自己
// 填 endpoint。
func All() []ProviderPreset {
	out := make([]ProviderPreset, 0, len(presetTable))
	for _, p := range presetTable {
		out = append(out, p)
	}
	slices.SortFunc(out, func(a, b ProviderPreset) int {
		switch {
		case a.Name < b.Name:
			return -1
		case a.Name > b.Name:
			return 1
		}
		return 0
	})
	return out
}
