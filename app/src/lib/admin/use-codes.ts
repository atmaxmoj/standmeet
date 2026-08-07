import { z } from 'zod';
// use-codes —— /admin/codes 的状态。zustand store 管 list cache + status；
// action 函数（create / revoke / updateQuotas / dispatchSave）跟 store
// 平级，调完直接 mutate / refresh。
//
// 这是 zustand 重构的样板：其他 hook 跟随同一 pattern。

import { useEffect } from 'react';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

// PathPermission —— retrieval-redesign 的准入单元。first-match-wins by
// A.3-IAM-5: PathPermission / corpus_permissions / granted_skills / skill_ids
// 全部从 code wire 形态删了 —— code 只挂 assumed_role_id，ACL / capability
// 都从 role 推断。
export const CodeViewSchema = z.object({
  id: z.string(), code: z.string(), label: z.string(), status: z.string(),
  purpose: z.string().optional(),
  // A slice column can serialize as JSON `null` (F-D-1); `.optional()` alone rejects null and
  // would throw the whole z.array(...) parse, blanking the list. Accept null on the wire but
  // map it away so the output type stays `string[] | undefined`. Backend now emits [] too
  // (DecodeStringJSON) — this is defense-in-depth so one bad row never hides the rest.
  ghosts: z.array(z.string()).nullish().transform((v) => v ?? undefined),
  expires_at: z.string().optional(),
  max_members: z.number().nullable().optional(),
  max_turns_per_session: z.number().nullable().optional(),
  max_bookings: z.number().nullable().optional(),
  // require_ghost_evidence —— F-A-10 per-code 覆盖:null/缺 = 继承 role;true/false = 显式覆盖。
  require_ghost_evidence: z.boolean().nullable().optional(),
  assumed_role_id: z.string(),
  prompt_id: z.string().nullable().optional(),
  // provider_id —— 这张码指定的 provider;'' = 继承 role,再退 owner 默认。
  provider_id: z.string().nullish().transform((v) => v ?? ''),
  // member_count —— 已经进来几个人。上限单独摆着说明不了任何事:一张满了的码跟一张全新的码
  // 会长得一模一样,而访客那头已经被挡在门外了(F-D-2)。旧后端不发这个字段,所以 nullish→0。
  member_count: z.number().nullish().transform((v) => v ?? 0),
});
export type CodeView = z.infer<typeof CodeViewSchema>;

export interface CreateCodeInput {
  code: string;
  label: string;
  purpose?: string;
  ghosts?: string[];
  max_members?: number | null;
  max_turns_per_session?: number | null;
  max_bookings?: number | null;
  assumed_role_id?: string | null;
  prompt_id?: string | null;
  provider_id?: string;
}

export interface QuotasInput {
  max_members: number | null;
  max_turns_per_session: number | null;
}

export interface CodesHook {
  status: ResourceStatus;
  codes: readonly CodeView[];
  error: string | null;
  refresh: () => Promise<void>;
  createCode: (input: CreateCodeInput) => Promise<void>;
  revokeCode: (id: string) => Promise<void>;
  updateQuotas: (id: string, input: QuotasInput) => Promise<void>;
  setGhostEvidence: (id: string, value: boolean | null) => Promise<void>;
}

// codesStore —— module-singleton；一次 fetch、所有 component 共享。
export const codesStore = createResourceStore<CodeView[]>({
  name: 'codes',
  fetcher: () => adminAPI.get('/codes/', z.array(CodeViewSchema)),
});

// useCodes —— component-facing hook。读 store + mount 时 ensureLoaded。
export function useCodes(): CodesHook {
  const r = useResource(codesStore);
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
    setGhostEvidence,
  };
}

// mutation 抛错（不再吞成 false）：调用方用 useAction 收尾（成功 toast / 失败 report），或就地内联。
async function createCode(input: CreateCodeInput): Promise<void> {
  const created = await adminAPI.post('/codes/', toCreateBody(input), CodeViewSchema);
  codesStore.getState().mutate((prev) => [created, ...(prev ?? [])]);
}

async function revokeCode(id: string): Promise<void> {
  await adminAPI.postVoid(`/codes/${id}/revoke`, {});
  codesStore.getState().mutate((prev) =>
    (prev ?? []).map((c) => c.id === id ? { ...c, status: 'revoked' } : c));
}

async function updateQuotas(id: string, input: QuotasInput): Promise<void> {
  const updated = await adminAPI.patch(`/codes/${id}/quotas`, input, CodeViewSchema);
  codesStore.getState().mutate((prev) =>
    (prev ?? []).map((c) => c.id === updated.id ? updated : c));
}

// setGhostEvidence —— F-A-10 per-code 覆盖:null = 继承 role;true/false = 显式覆盖(code 优先于 role)。
async function setGhostEvidence(id: string, value: boolean | null): Promise<void> {
  const updated = await adminAPI.patch(
    `/codes/${id}/ghost-evidence`, { require_ghost_evidence: value }, CodeViewSchema,
  );
  codesStore.getState().mutate((prev) =>
    (prev ?? []).map((c) => c.id === updated.id ? updated : c));
}

function toCreateBody(input: CreateCodeInput): Record<string, unknown> {
  return {
    code: input.code,
    label: input.label,
    purpose: input.purpose ?? '',
    ghosts: input.ghosts ?? [],
    max_members: input.max_members ?? null,
    max_turns_per_session: input.max_turns_per_session ?? null,
    max_bookings: input.max_bookings ?? null,
    assumed_role_id: input.assumed_role_id ?? null,
    prompt_id: input.prompt_id ?? null,
    // 空串 = 不指定(后端把空当"没给")。这里不发 null:那一列是 uuid 引用,
    // 后端收的是 string 形态的 id。
    provider_id: input.provider_id ?? '',
  };
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
    max_members: input.max_members ?? null,
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
