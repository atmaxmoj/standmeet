import { z } from 'zod';
// use-codes —— /admin/codes 的状态。zustand store 管 list cache + status；
// action 函数（create / revoke / updateQuotas / dispatchSave）跟 store
// 平级，调完直接 mutate / refresh。
//
// 这是 zustand 重构的样板：其他 hook 跟随同一 pattern。

import { useEffect } from 'react';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, readResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

// PathPermission —— retrieval-redesign 的准入单元。first-match-wins by
// order ascending；default deny。空列表 = 允许全部 (legacy 兼容)。
export interface PathPermission {
  action: 'allow' | 'deny';
  path_pattern: string;
  order?: number;
}

export const CodeViewSchema = z.object({
  id: z.string(), code: z.string(), label: z.string(), status: z.string(),
  corpus_permissions: z.array(z.object({ action: z.enum(['allow', 'deny']), path_pattern: z.string(), order: z.number().optional() })),
  purpose: z.string().optional(), suggested_questions: z.array(z.string()).optional(),
  max_sessions_per_member: z.number().nullable().optional(),
  max_turns_per_session: z.number().nullable().optional(),
  max_bookings: z.number().nullable().optional(),
  skill_ids: z.array(z.string()).optional(),
  granted_skills: z.array(z.string()).optional(),
  assumed_role_id: z.string().nullable().optional(),
});
export type CodeView = z.infer<typeof CodeViewSchema>;

export interface CreateCodeInput {
  code: string;
  label: string;
  corpus_permissions?: PathPermission[];
  purpose?: string;
  suggested_questions?: string[];
  max_sessions_per_member?: number | null;
  max_turns_per_session?: number | null;
  max_bookings?: number | null;
  skill_ids?: string[];
  granted_skills?: string[];
  assumed_role_id?: string | null;
}

export interface QuotasInput {
  max_sessions_per_member: number | null;
  max_turns_per_session: number | null;
}

export interface CodesHook {
  status: ResourceStatus;
  codes: readonly CodeView[];
  error: string | null;
  refresh: () => Promise<void>;
  createCode: (input: CreateCodeInput) => Promise<boolean>;
  revokeCode: (id: string) => Promise<boolean>;
  updateQuotas: (id: string, input: QuotasInput) => Promise<boolean>;
}

// codesStore —— module-singleton；一次 fetch、所有 component 共享。
export const codesStore = createResourceStore<CodeView[]>({
  name: 'codes',
  fetcher: () => adminAPI.get('/codes/', z.array(CodeViewSchema)),
});

// useCodes —— component-facing hook。读 store + mount 时 ensureLoaded。
export function useCodes(): CodesHook {
  const r = readResource(codesStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return {
    status: r.status,
    codes: r.data ?? [],
    error: r.error,
    refresh: codesStore.getState().refresh,
    createCode,
    revokeCode,
    updateQuotas,
  };
}

async function createCode(input: CreateCodeInput): Promise<boolean> {
  try {
    const created = await adminAPI.post('/codes/', toCreateBody(input), CodeViewSchema);
    codesStore.getState().mutate((prev) => [created, ...(prev ?? [])]);
    return true;
  } catch (e) {
    return swallow(e, 'create');
  }
}

async function revokeCode(id: string): Promise<boolean> {
  try {
    await adminAPI.postVoid(`/codes/${id}/revoke`, {});
    codesStore.getState().mutate((prev) =>
      (prev ?? []).map((c) => c.id === id ? { ...c, status: 'revoked' } : c));
    return true;
  } catch (e) {
    return swallow(e, 'revoke');
  }
}

async function updateQuotas(id: string, input: QuotasInput): Promise<boolean> {
  try {
    const updated = await adminAPI.patch(`/codes/${id}/quotas`, input, CodeViewSchema);
    codesStore.getState().mutate((prev) =>
      (prev ?? []).map((c) => c.id === updated.id ? updated : c));
    return true;
  } catch (e) {
    return swallow(e, 'update quotas');
  }
}

function toCreateBody(input: CreateCodeInput): Record<string, unknown> {
  return {
    code: input.code,
    label: input.label,
    purpose: input.purpose ?? '',
    corpus_permissions: input.corpus_permissions ?? [],
    suggested_questions: input.suggested_questions ?? [],
    max_sessions_per_member: input.max_sessions_per_member ?? null,
    max_turns_per_session: input.max_turns_per_session ?? null,
    max_bookings: input.max_bookings ?? null,
    skill_ids: input.skill_ids ?? [],
    granted_skills: input.granted_skills ?? [],
    assumed_role_id: input.assumed_role_id ?? null,
  };
}

function swallow(_e: unknown, _op: string): boolean {
  // 错误已经在 fetch 路径里 set 到 store.error；action 失败让 caller toast。
  return false;
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

// MemberView / listCodeMembers —— member 是 AccessCode 聚合的子实体，只读。
// revoke 在 code 级别（revokeCode）—— member 不该单独管。
const MemberViewSchema = z.object({
  id: z.string(), display_name: z.string(), email: z.string().optional(),
  is_anonymous: z.boolean(), last_seen_at: z.string().optional(),
});
export type MemberView = z.infer<typeof MemberViewSchema>;

export async function listCodeMembers(codeID: string): Promise<MemberView[]> {
  return await adminAPI.get(`/codes/${codeID}/members`, z.array(MemberViewSchema));
}
