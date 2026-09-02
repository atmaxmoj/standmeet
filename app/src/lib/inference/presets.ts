// presets.ts —— inference provider preset table (shared by the visitor
// BYOAI panel + the admin AI provider editor).
//
// Mirrors the server-side `backend/internal/inference/presets.go`: the
// admin UI also pulls a live copy from GET /api/admin/ai-provider/presets;
// this hardcoded copy is the fallback for the visitor side (visitors have
// no public preset endpoint, and SSR makes an extra fetch awkward). The two
// sides' values must stay in sync — adding a provider means updating both.
//
// **Deliberately no default model field**: the owner / visitor must type
// the model themselves (to prevent silently pointing at a stale / wrong
// default model). The UI has a "Load models" button that calls
// POST /api/v1/inference/models to pull the real available list and help
// pick one; if it's not clicked, the text input stays for manual entry.
//
// Uses:
//   - lists the UI dropdown (label is the display text)
//   - selecting an entry fills baseUrl into the endpoint input; model
//     always stays empty for the user to type
//   - when switching provider, if the owner / visitor hasn't touched the
//     endpoint (value == the old preset default), auto-refill the new
//     default; if they have touched it, keep their value
//
// **endpoint** carries no `/v1/...` path suffix (the OpenAI-compat adapter
// appends it internally). This lets a custom owner just type a base like
// "http://localhost:11434".

export interface InferencePreset {
  readonly name: string;        // canonical id ('openai' / 'custom' / ...)
  readonly label: string;       // UI display text
  readonly baseUrl: string;     // default base URL; '' for custom
  readonly keyPrefix: string;   // sanity check ('sk-' / 'gsk_' / ...); empty skips it
}

export const PRESETS: readonly InferencePreset[] = [
  {
    name: 'anthropic', label: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com', keyPrefix: 'sk-ant-',
  },
  {
    name: 'openai', label: 'OpenAI',
    baseUrl: 'https://api.openai.com', keyPrefix: 'sk-',
  },
  {
    name: 'deepseek', label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com', keyPrefix: 'sk-',
  },
  {
    name: 'kimi', label: 'Kimi (Moonshot)',
    baseUrl: 'https://api.moonshot.cn', keyPrefix: 'sk-',
  },
  {
    name: 'groq', label: 'Groq',
    baseUrl: 'https://api.groq.com/openai', keyPrefix: 'gsk_',
  },
  {
    name: 'siliconflow', label: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn', keyPrefix: 'sk-',
  },
  {
    name: 'openrouter', label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api', keyPrefix: 'sk-or-',
  },
  {
    name: 'together', label: 'Together AI',
    baseUrl: 'https://api.together.xyz', keyPrefix: '',
  },
  {
    name: 'custom', label: 'Custom (self-hosted: ollama / vllm / lm-studio)',
    baseUrl: '', keyPrefix: '',
  },
];

// lookupPreset —— provider name → preset. Returns undefined for an unknown
// provider (the caller decides the fallback behavior; usually treated as
// 'custom', requiring the owner to fill in endpoint+model themselves).
export function lookupPreset(name: string): InferencePreset | undefined {
  return PRESETS.find((p) => p.name === name);
}
