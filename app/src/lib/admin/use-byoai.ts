// use-byoai —— BYOAIEditor 的 local-state hook。
// 没有 backend 持久化路径，纯 UI 占位。enabled 默认 false（gate 上还没接 BYOAI）。

import { useCallback, useState } from 'react';

export type BYOAIProvider = 'claude' | 'openai' | 'gemini';

export interface BYOAIState {
  enabled: boolean;
  providers: BYOAIProvider[];
  blurb: string;
}

export interface BYOAIHook {
  state: BYOAIState;
  toggleEnabled: () => void;
  toggleProvider: (p: BYOAIProvider) => void;
  setBlurb: (v: string) => void;
}

const DEFAULT: BYOAIState = {
  enabled: false,
  providers: ['claude', 'openai'],
  blurb: 'Bring your own API key. You pay inference, I pay retrieval. Public scope only.',
};

export function useBYOAI(): BYOAIHook {
  const [state, setState] = useState<BYOAIState>(DEFAULT);

  const toggleEnabled = useCallback(() => {
    setState((s) => ({ ...s, enabled: !s.enabled }));
  }, []);

  const toggleProvider = useCallback((p: BYOAIProvider) => {
    setState((s) => ({ ...s, providers: nextProviders(s.providers, p) }));
  }, []);

  const setBlurb = useCallback((blurb: string) => setState((s) => ({ ...s, blurb })), []);

  return { state, toggleEnabled, toggleProvider, setBlurb };
}

function nextProviders(cur: readonly BYOAIProvider[], p: BYOAIProvider): BYOAIProvider[] {
  const has = cur.includes(p);
  const next = has ? cur.filter((x) => x !== p) : [...cur, p];
  // require at least one provider
  return next.length === 0 ? [p] : next;
}
