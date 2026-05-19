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
  // 返 boolean 让组件层 `await fn() && toast.success(...)` 串成功 toast。
  createCode: (input: CreateCodeInput) => Promise<boolean>;
  revokeCode: (id: string) => Promise<boolean>;
  updateQuotas: (id: string, input: QuotasInput) => Promise<boolean>;
}

export interface QuotasInput {
  max_sessions_per_member: number | null;
  max_turns_per_session: number | null;
}

// codeModalLabels —— modal 头部文案 / kicker / 是否 edit。switch-by-existing
// 的分支让 component 自己 cyclo ≤ 3，挪 lib 写 if/else。
export function codeModalLabels(
  existing: CodeView | null,
): { editing: boolean; kicker: string; title: string } {
  if (existing) {
    return { editing: true, kicker: 'edit code', title: existing.label };
  }
  return { editing: false, kicker: 'new code', title: 'gate a slice of your wiki' };
}

// dispatchSave —— "存档" 业务：editing 决定走 PATCH /quotas 还是 POST。把
// 分支挪 lib 让 component 复杂度 ≤ 3。
export async function dispatchSave(
  existing: CodeView | null,
  input: CreateCodeInput,
  onCreate: (input: CreateCodeInput) => Promise<void>,
  onUpdateQuotas: (id: string, input: QuotasInput) => Promise<void>,
): Promise<void> {
  if (existing === null) {
    await onCreate(input);
    return;
  }
  await onUpdateQuotas(existing.id, {
    max_sessions_per_member: input.max_sessions_per_member ?? null,
    max_turns_per_session: input.max_turns_per_session ?? null,
  });
}

export function useCodes(): CodesHook {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void initialLoad(cancelled, setState);
    return () => { cancelled = true; };
  }, []);

  const createCode = useCallback(
    async (input: CreateCodeInput) => await runCreate(input, setState),
    [],
  );

  const revokeCode = useCallback(
    async (id: string) => await runRevoke(id, setState),
    [],
  );

  const updateQuotas = useCallback(
    async (id: string, input: QuotasInput) => await runUpdateQuotas(id, input, setState),
    [],
  );

  return { state, createCode, revokeCode, updateQuotas };
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
): Promise<boolean> {
  try {
    const created = await adminAPI.post<CodeView>('/codes/', toCreateBody(input));
    setState((s) => prependCode(s, created));
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'create failed';
    setState((s) => s.kind === 'ready' ? { ...s, error: message } : s);
    return false;
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
): Promise<boolean> {
  try {
    await adminAPI.post<unknown>(`/codes/${id}/revoke`, {});
    setState((s) => markRevoked(s, id));
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'revoke failed';
    setState((s) => s.kind === 'ready' ? { ...s, error: message } : s);
    return false;
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

async function runUpdateQuotas(
  id: string, input: QuotasInput,
  setState: (updater: (s: State) => State) => void,
): Promise<boolean> {
  try {
    const updated = await adminAPI.patch<CodeView>(`/codes/${id}/quotas`, input);
    setState((s) => replaceCode(s, updated));
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'update quotas failed';
    setState((s) => s.kind === 'ready' ? { ...s, error: message } : s);
    return false;
  }
}

function replaceCode(s: State, code: CodeView): State {
  if (s.kind !== 'ready') return s;
  return {
    kind: 'ready', error: null,
    codes: s.codes.map((c) => c.id === code.id ? code : c),
  };
}
