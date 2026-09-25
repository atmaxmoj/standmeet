// presets.ts —— inference provider presets for a visitor bringing their own key (the app's /gate
// panel and the embedded AgentWidget both list these). Moved here from the app so there is one copy.
//
// Mirrors backend/internal/inference/presets.go; the admin UI pulls a live copy from
// GET /api/admin/ai-provider/presets, while visitors have no public preset endpoint, so this copy
// is theirs. Adding a provider means updating both sides.
//
// **Deliberately no default model**: the visitor types the model (or loads the list via
// POST /api/v1/inference/models) — a baked-in default silently goes stale.
//
// **baseUrl** carries no `/v1/...` suffix (the OpenAI-compatible adapter appends it), so a custom
// endpoint can be a bare base like "http://localhost:11434".

export interface InferencePreset {
  readonly name: string;        // canonical id ('openai' / 'custom' / ...)
  readonly label: string;       // UI display text
  readonly baseUrl: string;     // default base URL; '' for custom
  readonly keyPrefix: string;   // sanity check ('sk-' / 'gsk_' / ...); empty skips it
}

export const PRESETS: readonly InferencePreset[] = [
  { name: 'anthropic', label: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com', keyPrefix: 'sk-ant-' },
  { name: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com', keyPrefix: 'sk-' },
  { name: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', keyPrefix: 'sk-' },
  { name: 'kimi', label: 'Kimi (Moonshot)', baseUrl: 'https://api.moonshot.cn', keyPrefix: 'sk-' },
  { name: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai', keyPrefix: 'gsk_' },
  { name: 'siliconflow', label: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn', keyPrefix: 'sk-' },
  { name: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api', keyPrefix: 'sk-or-' },
  { name: 'together', label: 'Together AI', baseUrl: 'https://api.together.xyz', keyPrefix: '' },
  { name: 'custom', label: 'Custom (self-hosted: ollama / vllm / lm-studio)', baseUrl: '', keyPrefix: '' },
];

// lookupPreset —— provider name → preset; undefined for an unknown name (callers treat it as custom).
export function lookupPreset(name: string): InferencePreset | undefined {
  return PRESETS.find((p) => p.name === name);
}
