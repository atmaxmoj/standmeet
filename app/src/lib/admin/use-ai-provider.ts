// use-ai-provider —— /admin/api-mcp "AI provider" 块的状态。
// 读 owner profile（/me）拿当前 provider + 是否设过 key；commit 通过
// PATCH /admin/ai-provider 落库。明文 key 永远不在前端 state 里停留——
// submit 一过立刻丢。

import { useCallback, useEffect, useState } from 'react';

import { adminAPI } from '@/lib/api/admin';

export type AIProviderName = 'anthropic' | 'openai';

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
  key: string; // empty string → 不改 key（只切 provider）
}

interface MeAIProfile {
  ai_provider: AIProviderName;
  ai_provider_key_configured: boolean;
}

interface PatchResp {
  provider: AIProviderName;
  key_configured: boolean;
}

const INITIAL: AIProviderState = {
  provider: 'anthropic', keyConfigured: false,
  loading: true, saving: false, error: null,
};

export function useAIProvider(): AIProviderHook {
  const [state, setState] = useState<AIProviderState>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    void initialLoad(cancelled, setState);
    return () => { cancelled = true; };
  }, []);

  const save = useCallback(async (input: SaveInput): Promise<boolean> => {
    return await runPatch(
      { provider: input.provider, key_change: input.key === '' ? 'keep' : 'set', key: input.key },
      setState,
    );
  }, []);

  // clearKey —— 把 owner 的 key 清掉，provider 保持 default (anthropic)。
  // 这之后 visitor chat 会报"未配置 AI provider"（除非 INFERENCE_PROVIDER
  // =mock 在 env 设了，那种情况是 e2e/dev fixture）。
  const clearKey = useCallback(async (): Promise<boolean> => {
    return await runPatch(
      { provider: 'anthropic', key_change: 'clear' },
      setState,
    );
  }, []);

  return { state, save, clearKey };
}

async function initialLoad(
  cancelled: boolean,
  setState: (s: AIProviderState) => void,
): Promise<void> {
  try {
    const me = await adminAPI.get<MeAIProfile>('/me');
    cancelled || setState({
      provider: me.ai_provider, keyConfigured: me.ai_provider_key_configured,
      loading: false, saving: false, error: null,
    });
  } catch (e) {
    cancelled || setState({
      provider: 'anthropic', keyConfigured: false,
      loading: false, saving: false,
      error: e instanceof Error ? e.message : 'load failed',
    });
  }
}

async function runPatch(
  body: { provider: AIProviderName; key_change: 'keep' | 'set' | 'clear'; key?: string },
  setState: React.Dispatch<React.SetStateAction<AIProviderState>>,
): Promise<boolean> {
  setState((s) => ({ ...s, saving: true, error: null }));
  try {
    const resp = await adminAPI.patch<PatchResp>('/ai-provider', body);
    setState((s) => ({
      ...s, provider: resp.provider, keyConfigured: resp.key_configured,
      saving: false, error: null,
    }));
    return true;
  } catch (e) {
    setState((s) => ({
      ...s, saving: false, error: e instanceof Error ? e.message : 'save failed',
    }));
    return false;
  }
}
