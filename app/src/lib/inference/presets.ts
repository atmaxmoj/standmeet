// presets.ts —— inference provider preset 表（visitor BYOAI panel + admin
// AI provider editor 共享）。
//
// Mirror server-side `backend/internal/inference/presets.go`：admin UI 也会
// 从 GET /api/admin/ai-provider/presets 实时拉一份；这里硬编一份做 visitor
// 侧的兜底（visitor 没有公开 preset 端点，且 SSR 不便额外 fetch）。两端值
// 必须保持一致，新增 provider 同步改两边。
//
// **故意没有 default model 字段**：owner / visitor 必须自己输 model（防止
// 因为默认指过时 / 错误模型而不自知）。UI 上有 "Load models" button 调
// POST /api/v1/inference/models 拉真实可用列表帮选；不点就保留 text input
// 让用户手输。
//
// 用途：
//   - UI 列下拉（label 显示文本）
//   - 选某项时把 baseUrl 填进 endpoint input；model 始终留空让用户输
//   - 切 provider 时如果 owner / visitor 没改过 endpoint（值 == 旧 preset
//     默认），自动重填新默认；改过则保留
//
// **endpoint** 不带 `/v1/...` 路径后缀（OpenAI-compat adapter 内部拼）。
// 让 custom owner 只填 "http://localhost:11434" 这种 base。

export interface InferencePreset {
  readonly name: string;        // canonical id ('openai' / 'custom' / ...)
  readonly label: string;       // UI 显示
  readonly baseUrl: string;     // 默认 base URL；custom 是 ''
  readonly keyPrefix: string;   // sanity check ('sk-' / 'gsk_' / ...)；空跳过
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

// lookupPreset —— provider name → preset。未知 provider 返 undefined（caller
// 决定 fallback 行为；通常是当作 'custom' 处理，要求 owner 自填 endpoint+model）。
export function lookupPreset(name: string): InferencePreset | undefined {
  return PRESETS.find((p) => p.name === name);
}
