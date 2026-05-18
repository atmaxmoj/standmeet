// use-codes —— /admin/codes 状态机：list + create access codes。
//
// owner 给某个访客（reviewer / hiring manager / etc）发一个 LABEL-XXX 码，
// 设 tag scope。访客拿码进 /gate 颁发 session。这里只做最小：
// 列表 + 简单 create（code、label、tag 都用 plain text input）。

import { useCallback, useEffect, useState } from 'react';

import { adminAPI } from '@/lib/api/admin';

export interface CodeView {
  id: string;
  code: string;
  label: string;
  status: string;
  included_tags: string[];
  excluded_tags: string[];
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; codes: CodeView[]; error: string | null }
  | { kind: 'error'; message: string };

export interface CreateCodeInput {
  code: string;
  label: string;
  included_tags: string[];
}

export interface CodesHook {
  state: State;
  createCode: (input: CreateCodeInput) => Promise<void>;
}

export function useCodes(): CodesHook {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void initialLoad(cancelled, setState);
    return () => { cancelled = true; };
  }, []);

  const createCode = useCallback(async (input: CreateCodeInput) => {
    await runCreate(input, setState);
  }, []);

  return { state, createCode };
}

async function initialLoad(
  cancelled: boolean, setState: (s: State) => void,
): Promise<void> {
  const next = await fetchList();
  cancelled || setState(next);
}

async function fetchList(): Promise<State> {
  try {
    const codes = await adminAPI.get<CodeView[]>('/codes/');
    return { kind: 'ready', codes, error: null };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : 'load failed' };
  }
}

async function runCreate(
  input: CreateCodeInput,
  setState: (updater: (s: State) => State) => void,
): Promise<void> {
  try {
    const created = await adminAPI.post<CodeView>('/codes/', {
      code: input.code,
      label: input.label,
      purpose: '',
      included_tags: input.included_tags,
      excluded_tags: [],
      suggested_questions: [],
    });
    setState((s) => prependCode(s, created));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'create failed';
    setState((s) => s.kind === 'ready' ? { ...s, error: message } : s);
  }
}

function prependCode(s: State, code: CodeView): State {
  return s.kind === 'ready'
    ? { kind: 'ready', codes: [code, ...s.codes], error: null }
    : s;
}
