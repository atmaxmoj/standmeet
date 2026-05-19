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
  max_sessions_per_member?: number | null;
  max_turns_per_session?: number | null;
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
  max_sessions_per_member?: number | null;
  max_turns_per_session?: number | null;
}

export interface CodesHook {
  state: State;
  createCode: (input: CreateCodeInput) => Promise<void>;
  revokeCode: (id: string) => Promise<void>;
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

  const revokeCode = useCallback(async (id: string) => {
    await runRevoke(id, setState);
  }, []);

  return { state, createCode, revokeCode };
}

export interface MemberView {
  id: string;
  display_name: string;
  email?: string;
  revoked: boolean;
  is_anonymous: boolean;
  last_seen_at?: string;
}

export async function listCodeMembers(codeID: string): Promise<MemberView[]> {
  return await adminAPI.get<MemberView[]>(`/codes/${codeID}/members`);
}

export async function revokeMember(memberID: string): Promise<void> {
  await adminAPI.post<unknown>(`/codes/members/${memberID}/revoke`, {});
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
    const created = await adminAPI.post<CodeView>('/codes/', toCreateBody(input));
    setState((s) => prependCode(s, created));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'create failed';
    setState((s) => s.kind === 'ready' ? { ...s, error: message } : s);
  }
}

function toCreateBody(input: CreateCodeInput): Record<string, unknown> {
  return {
    code: input.code,
    label: input.label,
    purpose: input.purpose ?? '',
    included_tags: input.included_tags,
    excluded_tags: input.excluded_tags ?? [],
    suggested_questions: input.suggested_questions ?? [],
    max_sessions_per_member: input.max_sessions_per_member ?? null,
    max_turns_per_session: input.max_turns_per_session ?? null,
  };
}

async function runRevoke(
  id: string,
  setState: (updater: (s: State) => State) => void,
): Promise<void> {
  try {
    await adminAPI.post<unknown>(`/codes/${id}/revoke`, {});
    setState((s) => markRevoked(s, id));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'revoke failed';
    setState((s) => s.kind === 'ready' ? { ...s, error: message } : s);
  }
}

function prependCode(s: State, code: CodeView): State {
  return s.kind === 'ready'
    ? { kind: 'ready', codes: [code, ...s.codes], error: null }
    : s;
}

function markRevoked(s: State, id: string): State {
  if (s.kind !== 'ready') return s;
  return {
    kind: 'ready',
    error: null,
    codes: s.codes.map((c) => c.id === id ? { ...c, status: 'revoked' } : c),
  };
}
