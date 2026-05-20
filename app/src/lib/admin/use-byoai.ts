// use-byoai —— BYOAIEditor 的 state hook。
// 初始值从 sessionStore（/me）读；save → PUT /byoai → 让 sessionStore 重拉。
//
// zustand 重构：BYOAI form state 是 per-form 的（每次 mount 重置 baseline
// 到 /me），不上 global store；但 baseline 走全应用共享的 sessionStore。

import { useCallback, useEffect, useState } from 'react';

import { adminAPI, type BYOAIUpdateInput, type MeView } from '@/lib/api/admin';
import { sessionStore } from '@/lib/admin/use-admin-session';
import { readResource } from '@/lib/state/create-resource-store';

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
  const session = readResource(sessionStore);
  const ensureLoaded = session.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);

  const [state, setState] = useState<BYOAIState>(DEFAULT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 当 sessionStore 第一次 ready 时把 BYOAI baseline seed 进 local form state。
  useEffect(() => {
    if (session.status === 'ready' && session.data) {
      setState(byoaiFromMe(session.data));
    }
  }, [session.status, session.data]);

  const toggleEnabled = useCallback(() => {
    setState((s) => ({ ...s, enabled: !s.enabled }));
  }, []);
  const toggleProvider = useCallback((p: BYOAIProvider) => {
    setState((s) => ({ ...s, providers: nextProviders(s.providers, p) }));
  }, []);
  const setBlurb = useCallback((blurb: string) => setState((s) => ({ ...s, blurb })), []);
  const save = useCallback(() => doSave(state, setSaving, setError), [state]);
  return {
    state,
    loading: session.status === 'idle' || session.status === 'loading',
    saving,
    error: error ?? session.error,
    toggleEnabled,
    toggleProvider,
    setBlurb,
    save,
  };
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
    await sessionStore.getState().refresh();
    return true;
  } catch (e) {
    setErr(e instanceof Error ? e.message : 'save failed');
    return false;
  } finally {
    setSaving(false);
  }
}

function byoaiFromMe(me: MeView): BYOAIState {
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
