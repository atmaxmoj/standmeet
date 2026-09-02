// presets.go —— the inference provider preset table (UI endpoint defaults + listing + key
// prefix validation hints).
//
// **Deliberately has no default-model field**: the owner / visitor must always type in the
// model themselves (prevents them silently ending up on a stale / wrong default model). The UI
// has a "Load models" button that calls /api/v1/inference/models to pull the real available
// list to help pick; not clicking it just leaves a text input for manual entry.
//
// **Server-side use**: UpdateOwnerAIProviderInput / X-BYOAI-* headers validate the provider
// name is in the preset table + endpoint + model are all non-empty (the caller must fill them
// in completely).
//
// **Frontend-side use**: All() feeds the admin AIProviderPanel + visitor BYOAIPanel dropdown
// listings + auto-fills the endpoint default when an entry is picked. The model field is always
// left empty for the user to type.
//
// Note: every BaseURL **excludes** the `/v1/...` path (the adapter appends it internally).
// custom's BaseURL is left empty; when the owner self-hosts, they fill in the complete base
// themselves (e.g., http://localhost:11434).

package inference

import "slices"

// ProviderPreset —— metadata for one inference provider.
//
// fieldalignment: all string fields, alphabetical order is fine.
type ProviderPreset struct {
	BaseURL   string // the root for /v1/chat/completions (no path)
	KeyPrefix string // sanity check ("sk-" / "gsk_" / …); an empty value skips validation
	Label     string // display name for the UI
	Name      string // canonical lowercase id ('openai' / 'deepseek' / …)
}

// presetTable —— the source of truth for every built-in preset. Adding a provider only
// touches this table.
//
// `anthropic` is in the table (one unified UI dropdown), but the server resolver goes through
// anthropic.go's separate adapter (the Messages API isn't compatible with OpenAI Chat
// Completions). custom is self-hosted (ollama / vllm / lm-studio); BaseURL is left empty for
// the owner to fill in themselves.
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

// Lookup —— provider name → preset. An unknown provider returns zero value + false.
func Lookup(name string) (ProviderPreset, bool) {
	p, ok := presetTable[name]
	return p, ok
}

// All —— the complete preset list, in Name lexicographic order. Consumed directly by the
// frontend / admin UI dropdown listing; callers read BaseURL=="" to determine whether it's
// custom and needs the owner to fill in the endpoint themselves.
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
