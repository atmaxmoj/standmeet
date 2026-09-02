// use-ai-provider —— state for the "AI provider" block on /admin/api-mcp.
// Reads sessionStore for the current provider + whether a key is set;
// commit persists via PATCH /admin/ai-provider. The plaintext key never
// lingers in frontend state — it's dropped the instant submit runs.
//
// The PATCH body now adds two fields, endpoint + model, both required on
// every save (server-side required-field validation). When seeding the UI,
// if sessionStore has no saved endpoint/model (an old v1 /me response
// doesn't return them), preset defaults are used as a fallback, so the owner can at least save.

import { useCallback, useEffect, useState } from 'react';

import { adminAPI, SettingsViewSchema, type MeView } from '@/lib/api/admin';
import { sessionStore } from '@/lib/admin/use-admin-session';
import { useResource } from '@/lib/state/create-resource-store';

// AIProviderName —— the provider's canonical id; currently a bare string,
// not narrowed (anthropic / openai / deepseek / kimi / groq / siliconflow /
// openrouter / together / custom). The server validates invalid values.
export type AIProviderName = string;

export interface AIProviderState {
  provider: AIProviderName;
  // endpoint / model —— the SoT takes priority (the value the owner has
  // saved, as returned by /me), falling back to the preset default when empty.
  // #33: the form used to only ever use the preset default; a model/endpoint the owner had saved never got backfilled.
  endpoint: string;
  model: string;
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

// applySaveSuccess —— a lib-side wrapper for "run some side effects after a
// successful save", letting the component write `await applySaveSuccess(ok,
// ...)` instead of a comma-sequence like `ok && (a(), b())`.
export function applySaveSuccess(
  ok: boolean,
  ...effects: ReadonlyArray<() => void>
): void {
  if (!ok) return;
  for (const fn of effects) fn();
}

export interface SaveInput {
  provider: AIProviderName;
  endpoint: string; // required — the server validates it's non-empty
  model: string;    // required — the server validates it's non-empty
  key: string;      // empty string → don't change the key (only switches provider / endpoint / model)
}


export function useAIProvider(): AIProviderHook {
  const session = useResource(sessionStore);
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

  // clearKey —— clears the owner's key, keeping the current provider. clear
  // still has to send endpoint+model to satisfy the server's required-field
  // validation; falls back to the preset default endpoint/model for
  // sessionStore's current provider.
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

// defaultsFor —— given a provider name, looks up the default endpoint +
// model from a hardcoded preset table. lib/inference/presets is deliberately
// not imported here, to keep admin lib self-contained (presets are handed to
// the component layer after fetching /presets; an edge path like clear is
// fine using a known base from presets — worst case the server errors). An
// empty string sends the server down the "unknown provider" error path. A
// minimal mapping is hand-copied here; a new provider gets added in both places.
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
  session: ReturnType<typeof useResource<MeView>>,
  saving: boolean,
  error: string | null,
): AIProviderState {
  const ai = session.data?.settings.ai;
  const provider = ai?.provider ?? 'anthropic';
  const preset = defaultsFor(provider);
  return {
    provider,
    // The SoT (what the owner has saved) takes priority; falls back to the preset default when empty, so the owner can at least save.
    endpoint: ai?.endpoint || preset.endpoint,
    model: ai?.model || preset.model,
    keyConfigured: ai?.key_configured ?? false,
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
    await adminAPI.patch('/ai-provider', body, SettingsViewSchema);
    await sessionStore.getState().refresh();
    return true;
  } catch (e) {
    setErr(e instanceof Error ? e.message : 'save failed');
    return false;
  } finally {
    setSaving(false);
  }
}
