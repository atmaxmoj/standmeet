// llm-providers.ts —— provider 表 + model → provider 路由。
//
// 当前只列 OpenAI Chat Completions 兼容协议的两家 (DeepSeek + OpenAI)；
// Anthropic / Google Gemini 各自 wire 跟 OpenAI 不一样，加进来时这里
// 扩 ProviderProtocol = 'openai' | 'anthropic' | 'google'，llm-direct.ts
// 按 protocol 分支调对应 build/parse 函数。
//
// Model id 跟 backend/internal/inference/presets.go 的 catalog 对齐：
// owner 自己输 model 字段 (UI 不带 default model)，eval scenario 也一样。

export type ProviderProtocol = 'openai';

export interface ProviderConfig {
  readonly name: string;
  readonly envKey: string;
  readonly defaultBaseURL: string;
  readonly protocol: ProviderProtocol;
}

const PROVIDERS: Readonly<Record<string, ProviderConfig>> = {
  deepseek: {
    name: 'deepseek', envKey: 'DEEPSEEK_API_KEY',
    defaultBaseURL: 'https://api.deepseek.com', protocol: 'openai',
  },
  openai: {
    name: 'openai', envKey: 'OPENAI_API_KEY',
    defaultBaseURL: 'https://api.openai.com', protocol: 'openai',
  },
};

// MODEL_PREFIXES —— model id 第一段 (按 '-' 分) 决定 provider；'deepseek-chat'
// → deepseek, 'gpt-4o' → openai。新模型加这表即可，不动 adapter。
const MODEL_PREFIXES: Readonly<Record<string, string>> = {
  deepseek: 'deepseek',
  gpt: 'openai',
  o1: 'openai',
  o3: 'openai',
};

export class UnknownProviderError extends Error {
  override name = 'UnknownProviderError';
}

export function pickProvider(model: string): ProviderConfig {
  const prefix = model.split(/[-:/]/)[0]?.toLowerCase() ?? '';
  const providerName = MODEL_PREFIXES[prefix];
  if (!providerName) {
    throw new UnknownProviderError(
      `pickProvider: 不认识 model "${model}"。在 llm-providers.ts MODEL_PREFIXES 加 prefix → provider 映射。`,
    );
  }
  const p = PROVIDERS[providerName];
  if (!p) {
    throw new UnknownProviderError(`pickProvider: ${providerName} 未在 PROVIDERS 表`);
  }
  return p;
}
