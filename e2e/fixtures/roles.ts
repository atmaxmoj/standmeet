// roles.ts —— helper for creating a role via admin POST /api/admin/roles.
//
// When testing ACL: first create a role with corpus_uris (a positive-list URI glob),
// then issue a code referencing this role; after the session freezes, the retriever
// uses RoleSnapshot.AllowsCorpus to evaluate wiki/output/writing.

import type { APIRequestContext } from '@playwright/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// DockButtonConfig —— #109/#110 the owner config for one dock button: which capability it binds + the trigger word sent on click.
// A role has at most two (chat has two button slots).
export interface DockButtonConfig {
  capability_id: string;
  trigger: string;
}

// WaypointInput —— ghost-steering: a waypoint (a steering destination) the owner writes on a role.
// evidence_refs = the corpus evidence for that destination; at freeze time, any waypoint whose ref
// falls outside the role's authorized glob is dropped entirely (feasibility floor). is_terminal = a booking/contact-type endpoint.
interface WaypointInput {
  waypoint_id: string;
  description: string;
  weight: number;
  evidence_refs: string[];
  is_terminal?: boolean;
}

export interface CreateRoleInput {
  name: string;
  description?: string;
  greeting?: string;
  prompt_id?: string | null;
  corpus_uris?: string[];
  skill_ids?: string[];
  mcp_server_ids?: string[];
  dock_buttons?: DockButtonConfig[];
  waypoints?: WaypointInput[];
  // provider_id —— this role's inference provider. Unset = the owner's default. A code pointing at
  // its own provider outranks this.
  provider_id?: string | null;
  // gas_metered —— whether a turn on this role checks the provider's tank at all. Default false is
  // today's path: no gas query is issued.
  gas_metered?: boolean;
}

export interface RoleView {
  id: string;
  name: string;
  description: string;
  greeting: string;
  prompt_id?: string | null;
  corpus_uris: string[];
  skill_ids: string[];
  mcp_server_ids: string[];
  dock_buttons?: DockButtonConfig[];
  active_codes: number;
  is_builtin: boolean;
}

export async function createRole(
  request: APIRequestContext,
  csrf: string,
  input: CreateRoleInput,
): Promise<RoleView> {
  const res = await request.post(`${BACKEND}/api/admin/roles/`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      name: input.name,
      description: input.description ?? '',
      greeting: input.greeting ?? '',
      prompt_id: input.prompt_id ?? null,
      corpus_uris: input.corpus_uris ?? [],
      skill_ids: input.skill_ids ?? [],
      mcp_server_ids: input.mcp_server_ids ?? [],
      dock_buttons: input.dock_buttons ?? [],
      waypoints: input.waypoints ?? [],
      provider_id: input.provider_id ?? null,
      gas_metered: input.gas_metered ?? false,
    },
  });
  if (res.status() !== 201) {
    const body = await res.text();
    throw new Error(`create role failed: ${res.status()} ${body}`);
  }
  return await res.json() as RoleView;
}

export async function getRoleByName(
  request: APIRequestContext,
  name: string,
): Promise<RoleView> {
  const res = await request.get(`${BACKEND}/api/admin/roles/`);
  if (res.status() !== 200) throw new Error(`list roles failed: ${res.status()}`);
  const list = await res.json() as RoleView[];
  const role = list.find((r) => r.name === name);
  if (!role) throw new Error(`role ${name} not found`);
  return role;
}
