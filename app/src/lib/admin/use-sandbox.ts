// use-sandbox —— #147 admin management of the MCP sandbox. GET
// /api/admin/sandbox/workspaces lists active per-session workspaces; POST
// /sandbox/ttl sets the backend-controlled TTL; POST /sandbox/sweep sweeps
// expired ones on demand. Shaped after use-ip-bans (zustand resource store +
// mutation actions).

import { useEffect } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

export const WorkspaceSchema = z.object({
  id: z.string(),
  mod_time: z.string(),
  age_secs: z.number(),
});
export type SandboxWorkspace = z.infer<typeof WorkspaceSchema>;

const WorkspaceListSchema = z.object({ workspaces: z.array(WorkspaceSchema) });
const SweepSchema = z.object({ removed: z.number(), ok: z.boolean() });

export interface SandboxHook {
  status: ResourceStatus;
  workspaces: readonly SandboxWorkspace[];
  error: string | null;
  sweep: () => Promise<void>;
  setTTL: (seconds: number) => Promise<void>;
}

export const sandboxStore = createResourceStore<SandboxWorkspace[]>({
  name: 'sandbox-workspaces',
  fetcher: () => adminAPI.get('/sandbox/workspaces', WorkspaceListSchema).then((r) => r.workspaces),
});

export function useSandbox(): SandboxHook {
  const r = useResource(sandboxStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return {
    status: r.status,
    workspaces: r.data ?? [],
    error: r.error,
    sweep,
    setTTL,
  };
}

// The mutation throws (not swallowed): the caller finishes up with useAction
// (success toast / failure report).
async function sweep(): Promise<void> {
  await adminAPI.post('/sandbox/sweep', {}, SweepSchema);
  await sandboxStore.getState().refresh();
}

async function setTTL(seconds: number): Promise<void> {
  await adminAPI.postVoid('/sandbox/ttl', { seconds });
}
