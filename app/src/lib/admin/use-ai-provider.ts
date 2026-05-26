// use-ai-provider —— /admin/api-mcp "AI provider" 块的状态。
// 读 sessionStore 拿当前 provider + 是否设过 key；commit 通过
// PATCH /admin/ai-provider 落库。明文 key 永远不在前端 state 里停留——
// submit 一过立刻丢。
//
// 现在 PATCH body 加 endpoint + model 两个字段，每次 save 都必须送（server
// 端必填校验）。UI seed 时如果 sessionStore 里没保存的 endpoint/model（v1
// 老 /me 不返回这俩），用 preset 默认值兜底，让 owner 至少能 save。

import { useCallback, useEffect, useState } from 'react';

import { adminAPI, type MeView, type SettingsView } from '@/lib/api/admin';
import { sessionStore } from '@/lib/admin/use-admin-session';
import { readResource } from '@/lib/state/create-resource-store';

// AIProviderName —— provider canonical id；现在 string 不收窄（anthropic /
// openai / deepseek / kimi / groq / siliconflow / openrouter / together /
// custom）。server 端校验非法值。
export type AIProviderName = string;

export interface AIProviderState {
  provider: AIProviderName;
  keyConfigured: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

export interface AIProviderHook {
  state: AIProviderState;
  save: (input: SaveInput) => Promise<boolean>;
  clearKey: () => Promise<boolean>;
}

// applySaveSuccess —— "save ok 之后跑两个副作用"的 lib-side wrapper，给
// component 写 `await applySaveSuccess(ok, ...)` 而不是 `ok && (a(), b())`
// 那种 comma sequence。
export function applySaveSuccess(
  ok: boolean,
  ...effects: ReadonlyArray<() => void>
): void {
  if (!ok) return;
  for (const fn of effects) fn();
}

export interface SaveInput {
  provider: AIProviderName;
  endpoint: string; // 必填 —— server 端校验非空
  model: string;    // 必填 —— server 端校验非空
  key: string;      // empty string → 不改 key（只切 provider / endpoint / model）
}

// PatchResp —— PATCH /ai-provider 现在直接回新 SettingsView 一片。
type PatchResp = SettingsView;

export function useAIProvider(): AIProviderHook {
  const session = readResource(sessionStore);
  const ensureLoaded = session.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(async (input: SaveInput): Promise<boolean> => {
    return await runPatch(
      {
        provider: input.provider,
        endpoint: input.endpoint,
        model: input.model,
        key_change: input.key === '' ? 'keep' : 'set',
        key: input.key,
      },
      setSaving, setError,
    );
  }, []);

  // clearKey —— 把 owner 的 key 清掉，provider 保持当前。clear 仍然要送
  // endpoint+model 满足 server 必填校验；用 sessionStore 当前的 provider
  // 配 preset 默认 endpoint/model 兜底。
  const clearKey = useCallback(async (): Promise<boolean> => {
    const current = session.data?.settings.ai.provider ?? 'anthropic';
    const { endpoint, model } = defaultsFor(current);
    return await runPatch(
      { provider: current, endpoint, model, key_change: 'clear' },
      setSaving, setError,
    );
  }, [session.data]);

  return {
    state: deriveState(session, saving, error),
    save,
    clearKey,
  };
}

// defaultsFor —— 给定 provider 名，从 hardcode preset 表里查默认 endpoint
// + model。这里特意不 import lib/inference/presets 以保持 admin lib 自包含
// （preset 在 fetch /presets 后给到组件层；clear 这种边界路径用 preset 中
// 已知 base 也够，最坏 server 端会报错）。空 string 让 server 走"unknown
// provider" 报错。这里手抄一份最小映射，新 provider 同步加。
function defaultsFor(provider: string): { endpoint: string; model: string } {
  const m: Record<string, { endpoint: string; model: string }> = {
    anthropic: {
      endpoint: 'https://api.anthropic.com', model: 'claude-haiku-4-5-20251001',
    },
    openai: {
      endpoint: 'https://api.openai.com', model: 'gpt-4o-mini',
    },
    deepseek: {
      endpoint: 'https://api.deepseek.com', model: 'deepseek-chat',
    },
    kimi: {
      endpoint: 'https://api.moonshot.cn', model: 'moonshot-v1-8k',
    },
    groq: {
      endpoint: 'https://api.groq.com/openai', model: 'llama-3.3-70b-versatile',
    },
    siliconflow: {
      endpoint: 'https://api.siliconflow.cn', model: 'Qwen/Qwen2.5-7B-Instruct',
    },
    openrouter: {
      endpoint: 'https://openrouter.ai/api', model: 'openai/gpt-4o-mini',
    },
    together: {
      endpoint: 'https://api.together.xyz',
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    },
  };
  return m[provider] ?? { endpoint: '', model: '' };
}

function deriveState(
  session: ReturnType<typeof readResource<MeView>>,
  saving: boolean,
  error: string | null,
): AIProviderState {
  return {
    provider: session.data?.settings.ai.provider ?? 'anthropic',
    keyConfigured: session.data?.settings.ai.key_configured ?? false,
    loading: session.status === 'idle' || session.status === 'loading',
    saving,
    error: error ?? session.error,
  };
}

async function runPatch(
  body: {
    provider: AIProviderName;
    endpoint: string;
    model: string;
    key_change: 'keep' | 'set' | 'clear';
    key?: string;
  },
  setSaving: (b: boolean) => void,
  setErr: (m: string | null) => void,
): Promise<boolean> {
  setSaving(true);
  setErr(null);
  try {
    await adminAPI.patch<PatchResp>('/ai-provider', body);
    await sessionStore.getState().refresh();
    return true;
  } catch (e) {
    setErr(e instanceof Error ? e.message : 'save failed');
    return false;
  } finally {
    setSaving(false);
  }
}
