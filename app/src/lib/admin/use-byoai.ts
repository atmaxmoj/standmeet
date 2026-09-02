// use-byoai —— state hook for BYOAIEditor.
// Initial value is read from sessionStore (/me); save → PUT /byoai → makes
// sessionStore refetch.
//
// zustand refactor: BYOAI form state is per-form (baseline resets to /me on
// every mount), not backed by a global store; but the baseline goes through
// the app-wide shared sessionStore.

import { useCallback, useEffect, useState } from 'react';

import { adminAPI, MeViewSchema, type BYOAIUpdateInput, type MeView } from '@/lib/api/admin';
import { sessionStore } from '@/lib/admin/use-admin-session';
import { useResource } from '@/lib/state/create-resource-store';

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
  const session = useResource(sessionStore);
  const ensureLoaded = session.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);

  const [state, setState] = useState<BYOAIState>(DEFAULT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the BYOAI baseline into local form state the first time sessionStore becomes ready.
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
    await adminAPI.put('/byoai', body, MeViewSchema);
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
  const known = new Set<string>(['claude', 'openai', 'gemini']);
  const filtered = me.settings.byoai.providers.filter(
    (p): p is BYOAIProvider => known.has(p),
  );
  return {
    enabled: me.settings.byoai.enabled,
    providers: filtered.length === 0 ? ['claude'] : filtered,
    blurb: me.settings.byoai.public_blurb,
  };
}

function nextProviders(cur: readonly BYOAIProvider[], p: BYOAIProvider): BYOAIProvider[] {
  const has = cur.includes(p);
  const next = has ? cur.filter((x) => x !== p) : [...cur, p];
  return next.length === 0 ? [p] : next;
}
