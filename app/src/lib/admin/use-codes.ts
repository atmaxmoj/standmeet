// use-codes —— /admin/codes 状态机：list + create access codes。
// 简单版只支持 code/label/included_tags；create 用 modal 时支持更多字段。

import { useCallback, useEffect, useState } from 'react';

import { adminAPI } from '@/lib/api/admin';

export interface CodeView {
  id: string;
  code: string;
  label: string;
  status: string;
  included_tags: string[];
  excluded_tags: string[];
  purpose?: string;
  suggested_questions?: string[];
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; codes: CodeView[]; error: string | null }
  | { kind: 'error'; message: string };

export interface CreateCodeInput {
  code: string;
  label: string;
  included_tags: string[];
  excluded_tags?: string[];
  purpose?: string;
  suggested_questions?: string[];
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
      purpose: input.purpose ?? '',
      included_tags: input.included_tags,
      excluded_tags: input.excluded_tags ?? [],
      suggested_questions: input.suggested_questions ?? [],
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
