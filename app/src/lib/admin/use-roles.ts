// use-roles —— /admin/roles state store + CRUD actions. Shaped after
// use-prompts; adds the three corpus_uris + skill_ids + mcp_server_ids joins
// + the active_codes count (read-only, computed by the server).

import { useEffect } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

// DockButtonConfig —— #109/#110 config for one chat dock button: which capability it's attached to + the trigger phrase it sends on click.
export const DockButtonConfigSchema = z.object({
  capability_id: z.string(),
  trigger: z.string(),
});
export type DockButtonConfig = z.infer<typeof DockButtonConfigSchema>;

// WaypointConfig —— F-A-7 one ghost-steering waypoint. Written per-role by
// the owner: id + description + weight + whether it's a terminal
// (booking/contact) + the corpus evidence URIs backing it (empty = no
// evidence; pairs with F-A-10's "requires evidence" toggle).
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
  // provider_id —— which provider this role uses; '' = the owner's default one. The one attached to a code overrides it.
  provider_id: z.string().nullish().transform((v) => v ?? ''),
  // gas_metered —— whether this role has a fuel gauge attached (#7). false = never sends a gas query.
  gas_metered: z.boolean().nullish().transform((v) => v ?? false),
  corpus_uris: z.array(z.string()),
  skill_ids: z.array(z.string()),
  mcp_server_ids: z.array(z.string()),
  dock_buttons: z.array(DockButtonConfigSchema).optional(),
  // waypoints —— F-A-7: ghost-steering waypoints (written per-role by the owner).
  waypoints: z.array(WaypointConfigSchema).optional(),
  // require_ghost_evidence —— F-A-10: whether content-steering ghosts require
  // corpus evidence (a non-terminal waypoint with no evidence isn't offered).
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
  // provider_id —— '' = unspecified, uses the owner's default.
  provider_id: string;
  // gas_metered —— whether the fuel gauge is attached.
  gas_metered: boolean;
  corpus_uris: string[];
  skill_ids: string[];
  mcp_server_ids: string[];
  dock_buttons?: DockButtonConfig[];
  waypoints?: WaypointConfig[];
  require_ghost_evidence?: boolean;
}

// roleUpdatePayload —— assembles a full PUT payload from the current
// RoleView, then layers overrides on top. **Every** partial save on a role
// card (prompt / corpus / dock / ghost / description …) must go through
// this: each call site expresses only the one field it changed, everything
// else is written back unchanged. Centralizing it here means a new field
// only needs to be added in one place, structurally ruling out the bug class
// of "a save forgot a field and zeroed it out" (F-A-10's dock/corpus save
// used to zero out require_ghost_evidence).
export function roleUpdatePayload(
  role: RoleView, overrides: Partial<WriteRoleInput> = {},
): WriteRoleInput {
  return {
    name: role.name,
    description: role.description,
    greeting: role.greeting,
    prompt_id: role.prompt_id ?? null,
    provider_id: role.provider_id,
    gas_metered: role.gas_metered,
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

// The mutation throws (no longer swallowed into null / false): the caller
// finishes up with useAction (success toast / failure report), or inline try/catch.
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
