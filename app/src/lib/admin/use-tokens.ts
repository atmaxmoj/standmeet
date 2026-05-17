// use-tokens —— /admin/api-mcp 的状态机：list / create / delete API tokens。
//
// 创建返回 plaintext 一次性；UI 把它 highlight 出来让 owner 复制（关掉这条
// 之后就再也看不到）。delete 是硬删，不可恢复。

import { useCallback, useEffect, useState } from 'react';

import { adminAPI } from '@/lib/api/admin';

export interface TokenItem {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

interface CreatedToken {
  id: string;
  name: string;
  plaintext: string;
  created_at: string;
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; tokens: TokenItem[]; justCreated: CreatedToken | null; error: string | null }
  | { kind: 'error'; message: string };

export interface TokensHook {
  state: State;
  createToken: (name: string) => Promise<void>;
  deleteToken: (id: string) => Promise<void>;
  dismissCreated: () => void;
}

export function useTokens(): TokensHook {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void initialLoad(cancelled, setState);
    return () => { cancelled = true; };
  }, []);

  const createToken = useCallback(async (name: string) => {
    await runCreate(name, setState);
  }, []);

  const deleteToken = useCallback(async (id: string) => {
    await runDelete(id, setState);
  }, []);

  const dismissCreated = useCallback(() => {
    setState((s) => s.kind === 'ready' ? { ...s, justCreated: null } : s);
  }, []);

  return { state, createToken, deleteToken, dismissCreated };
}

async function initialLoad(
  cancelled: boolean, setState: (s: State) => void,
): Promise<void> {
  const next = await fetchList();
  cancelled || setState(next);
}

async function fetchList(): Promise<State> {
  try {
    const tokens = await adminAPI.get<TokenItem[]>('/tokens');
    return { kind: 'ready', tokens, justCreated: null, error: null };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : 'load failed' };
  }
}

async function runCreate(name: string, setState: (updater: (s: State) => State) => void): Promise<void> {
  try {
    const created = await adminAPI.post<CreatedToken>('/tokens', { name });
    setState((s) => mergeAfterCreate(s, created));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'create failed';
    setState((s) => s.kind === 'ready' ? { ...s, error: message } : s);
  }
}

function mergeAfterCreate(s: State, created: CreatedToken): State {
  return s.kind === 'ready'
    ? { kind: 'ready', tokens: [toListItem(created), ...s.tokens], justCreated: created, error: null }
    : s;
}

function toListItem(c: CreatedToken): TokenItem {
  return { id: c.id, name: c.name, created_at: c.created_at, last_used_at: null };
}

async function runDelete(id: string, setState: (updater: (s: State) => State) => void): Promise<void> {
  try {
    await adminAPI.delete<void>(`/tokens/${id}`);
    setState((s) => removeFromList(s, id));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'delete failed';
    setState((s) => s.kind === 'ready' ? { ...s, error: message } : s);
  }
}

function removeFromList(s: State, id: string): State {
  return s.kind === 'ready'
    ? { ...s, tokens: s.tokens.filter((t) => t.id !== id) }
    : s;
}
