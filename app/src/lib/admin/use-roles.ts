// use-roles —— /admin/roles 状态 store + CRUD actions。形态参照
// use-prompts；多了 corpus_uris + skill_ids + mcp_server_ids 三组 join +
// active_codes count（read-only，server 算）。

import { useEffect } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

// DockButtonConfig —— #109/#110 一个 chat dock 按钮的配置：挂哪个能力 + 点击发出的触发词。
export const DockButtonConfigSchema = z.object({
  capability_id: z.string(),
  trigger: z.string(),
});
export type DockButtonConfig = z.infer<typeof DockButtonConfigSchema>;

// WaypointConfig —— F-A-7 一个 ghost-steering 引导目的地。owner per-role 写:id + 描述 + 权重 +
// 是否终点(booking/contact) + 支撑它的 corpus 证据 URI(空 = 无证据;配合 F-A-10 的「需证据」开关)。
export const WaypointConfigSchema = z.object({
  waypoint_id: z.string(),
  description: z.string(),
  evidence_refs: z.array(z.string()),
  weight: z.number(),
  is_terminal: z.boolean(),
});
export type WaypointConfig = z.infer<typeof WaypointConfigSchema>;

export const RoleViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  greeting: z.string(),
  prompt_id: z.string().nullable().optional(),
  // provider_id —— 这个 role 走哪条 provider;'' = owner 默认那条。挂在码上的那条压过它。
  provider_id: z.string().nullish().transform((v) => v ?? ''),
  corpus_uris: z.array(z.string()),
  skill_ids: z.array(z.string()),
  mcp_server_ids: z.array(z.string()),
  dock_buttons: z.array(DockButtonConfigSchema).optional(),
  // waypoints —— F-A-7: ghost-steering 引导目的地(owner per-role 写)。
  waypoints: z.array(WaypointConfigSchema).optional(),
  // require_ghost_evidence —— F-A-10: 内容型引导 ghost 是否要求语料证据(空证据非终点 waypoint 不提)。
  require_ghost_evidence: z.boolean().optional(),
  active_codes: z.number(),
  is_builtin: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type RoleView = z.infer<typeof RoleViewSchema>;

export interface WriteRoleInput {
  name: string;
  description: string;
  greeting: string;
  prompt_id: string | null;
  // provider_id —— '' = 不指定,走 owner 默认那条。
  provider_id: string;
  corpus_uris: string[];
  skill_ids: string[];
  mcp_server_ids: string[];
  dock_buttons?: DockButtonConfig[];
  waypoints?: WaypointConfig[];
  require_ghost_evidence?: boolean;
}

// roleUpdatePayload —— 从当前 RoleView 组一份全量 PUT 载荷,再叠加 overrides。**所有** role 卡上的
// 局部保存(prompt / corpus / dock / ghost / description …)都必须走这里:每处只表达自己改的那一个
// 字段,其余原样回写。集中一处 → 加新字段只改这里,结构上杜绝"某个保存漏带某字段把它清零"的 bug 类
// (F-A-10 的 dock/corpus 保存曾清零 require_ghost_evidence)。
export function roleUpdatePayload(
  role: RoleView, overrides: Partial<WriteRoleInput> = {},
): WriteRoleInput {
  return {
    name: role.name,
    description: role.description,
    greeting: role.greeting,
    prompt_id: role.prompt_id ?? null,
    provider_id: role.provider_id,
    corpus_uris: role.corpus_uris,
    skill_ids: role.skill_ids,
    mcp_server_ids: role.mcp_server_ids,
    dock_buttons: role.dock_buttons,
    waypoints: role.waypoints,
    require_ghost_evidence: role.require_ghost_evidence,
    ...overrides,
  };
}

export interface RolesHook {
  status: ResourceStatus;
  roles: readonly RoleView[];
  error: string | null;
  refresh: () => Promise<void>;
  createRole: (input: WriteRoleInput) => Promise<RoleView>;
  updateRole: (id: string, input: WriteRoleInput) => Promise<RoleView>;
  deleteRole: (id: string) => Promise<void>;
}

export const rolesStore = createResourceStore<RoleView[]>({
  name: 'roles',
  fetcher: () => adminAPI.get('/roles/', z.array(RoleViewSchema)),
});

export function useRoles(): RolesHook {
  const r = useResource(rolesStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return {
    status: r.status,
    roles: r.data ?? [],
    error: r.error,
    refresh: rolesStore.getState().refresh,
    createRole,
    updateRole,
    deleteRole,
  };
}

// mutation 抛错（不再吞成 null / false）：调用方用 useAction 收尾（成功 toast / 失败 report），或就地 try/catch。
async function createRole(input: WriteRoleInput): Promise<RoleView> {
  const created = await adminAPI.post('/roles/', input, RoleViewSchema);
  rolesStore.getState().mutate((prev) => [...(prev ?? []), created]);
  return created;
}

async function updateRole(id: string, input: WriteRoleInput): Promise<RoleView> {
  const updated = await adminAPI.put(`/roles/${id}`, input, RoleViewSchema);
  rolesStore.getState().mutate(
    (prev) => (prev ?? []).map((r) => (r.id === id ? updated : r)),
  );
  return updated;
}

async function deleteRole(id: string): Promise<void> {
  await adminAPI.deleteVoid(`/roles/${id}`);
  rolesStore.getState().mutate((prev) => (prev ?? []).filter((r) => r.id !== id));
}
