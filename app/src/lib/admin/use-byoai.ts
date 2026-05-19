// use-byoai —— BYOAIEditor 的 state hook。
// 初始 GET /me 加载；PUT /byoai 持久化（debounced auto-save 简化为显式 save）。

import { useCallback, useEffect, useState } from 'react';

import { adminAPI, type BYOAIUpdateInput, type MeView } from '@/lib/api/admin';

export type BYOAIProvider = 'claude' | 'openai' | 'gemini';

export interface BYOAIState {
  enabled: boolean;
  providers: BYOAIProvider[];
  blurb: string;
}

export interface BYOAIHook {
  state: BYOAIState;
  loading: boolean;
  saving: boolean;
  error: string | null;
  toggleEnabled: () => void;
  toggleProvider: (p: BYOAIProvider) => void;
  setBlurb: (v: string) => void;
  save: () => Promise<boolean>;
}

const DEFAULT: BYOAIState = {
  enabled: false,
  providers: ['claude', 'openai'],
  blurb: '',
};

export function useBYOAI(): BYOAIHook {
  const [state, setState] = useState<BYOAIState>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void initialLoad(cancelled, setState, setLoading, setError);
    return () => { cancelled = true; };
  }, []);

  const toggleEnabled = useCallback(() => {
    setState((s) => ({ ...s, enabled: !s.enabled }));
  }, []);
  const toggleProvider = useCallback((p: BYOAIProvider) => {
    setState((s) => ({ ...s, providers: nextProviders(s.providers, p) }));
  }, []);
  const setBlurb = useCallback((blurb: string) => setState((s) => ({ ...s, blurb })), []);
  const save = useCallback(
    () => doSave(state, setSaving, setError),
    [state],
  );
  return { state, loading, saving, error, toggleEnabled, toggleProvider, setBlurb, save };
}

async function initialLoad(
  cancelled: boolean,
  setState: (s: BYOAIState) => void,
  setLoading: (b: boolean) => void,
  setErr: (m: string | null) => void,
): Promise<void> {
  try {
    const me = await adminAPI.get<MeView>('/me');
    if (cancelled) return;
    setState(toState(me));
  } catch (e) {
    cancelled || setErr(e instanceof Error ? e.message : 'load failed');
  } finally {
    cancelled || setLoading(false);
  }
}

async function doSave(
  state: BYOAIState,
  setSaving: (b: boolean) => void,
  setErr: (m: string | null) => void,
): Promise<boolean> {
  setSaving(true);
  setErr(null);
  try {
    const body: BYOAIUpdateInput = {
      enabled: state.enabled,
      providers: state.providers,
      blurb: state.blurb,
    };
    await adminAPI.put<MeView>('/byoai', body);
    return true;
  } catch (e) {
    setErr(e instanceof Error ? e.message : 'save failed');
    return false;
  } finally {
    setSaving(false);
  }
}

function toState(me: MeView): BYOAIState {
  const known: readonly BYOAIProvider[] = ['claude', 'openai', 'gemini'];
  const filtered = me.byoai_providers.filter(
    (p): p is BYOAIProvider => (known as readonly string[]).includes(p),
  );
  return {
    enabled: me.byoai_enabled,
    providers: filtered.length === 0 ? ['claude'] : filtered,
    blurb: me.byoai_public_blurb,
  };
}

function nextProviders(cur: readonly BYOAIProvider[], p: BYOAIProvider): BYOAIProvider[] {
  const has = cur.includes(p);
  const next = has ? cur.filter((x) => x !== p) : [...cur, p];
  return next.length === 0 ? [p] : next;
}
