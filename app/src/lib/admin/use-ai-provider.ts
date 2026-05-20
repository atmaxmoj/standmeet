// use-ai-provider —— /admin/api-mcp "AI provider" 块的状态。
// 读 sessionStore 拿当前 provider + 是否设过 key；commit 通过
// PATCH /admin/ai-provider 落库。明文 key 永远不在前端 state 里停留——
// submit 一过立刻丢。

import { useCallback, useEffect, useState } from 'react';

import { adminAPI, type MeView } from '@/lib/api/admin';
import { sessionStore } from '@/lib/admin/use-admin-session';
import { readResource } from '@/lib/state/create-resource-store';

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

interface PatchResp {
  provider: AIProviderName;
  key_configured: boolean;
}

export function useAIProvider(): AIProviderHook {
  const session = readResource(sessionStore);
  const ensureLoaded = session.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(async (input: SaveInput): Promise<boolean> => {
    return await runPatch(
      { provider: input.provider, key_change: input.key === '' ? 'keep' : 'set', key: input.key },
      setSaving, setError,
    );
  }, []);

  // clearKey —— 把 owner 的 key 清掉，provider 保持 default (anthropic)。
  // 这之后 visitor chat 会报"未配置 AI provider"（除非 INFERENCE_PROVIDER
  // =mock 在 env 设了，那种情况是 e2e/dev fixture）。
  const clearKey = useCallback(async (): Promise<boolean> => {
    return await runPatch(
      { provider: 'anthropic', key_change: 'clear' },
      setSaving, setError,
    );
  }, []);

  return {
    state: deriveState(session, saving, error),
    save,
    clearKey,
  };
}

function deriveState(
  session: ReturnType<typeof readResource<MeView>>,
  saving: boolean,
  error: string | null,
): AIProviderState {
  return {
    provider: session.data?.ai_provider ?? 'anthropic',
    keyConfigured: session.data?.ai_provider_key_configured ?? false,
    loading: session.status === 'idle' || session.status === 'loading',
    saving,
    error: error ?? session.error,
  };
}

async function runPatch(
  body: { provider: AIProviderName; key_change: 'keep' | 'set' | 'clear'; key?: string },
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
