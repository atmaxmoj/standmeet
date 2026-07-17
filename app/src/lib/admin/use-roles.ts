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

export const RoleViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  greeting: z.string(),
  prompt_id: z.string().nullable().optional(),
  corpus_uris: z.array(z.string()),
  skill_ids: z.array(z.string()),
  mcp_server_ids: z.array(z.string()),
  dock_buttons: z.array(DockButtonConfigSchema).optional(),
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
  corpus_uris: string[];
  skill_ids: string[];
  mcp_server_ids: string[];
  dock_buttons?: DockButtonConfig[];
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
