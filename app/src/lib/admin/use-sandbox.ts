// use-sandbox —— #147 admin 管理 MCP 沙箱。GET /api/admin/sandbox/workspaces 列活跃
// per-session 工作区;POST /sandbox/ttl 设后端可控 TTL;POST /sandbox/sweep 按需清扫过期。
// 形态参照 use-ip-bans(zustand resource store + mutation actions)。

import { useEffect } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, readResource } from '@/lib/state/create-resource-store';
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
  const r = readResource(sandboxStore);
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

// mutation 抛错(不吞):调用方用 useAction 收尾(成功 toast / 失败 report)。
async function sweep(): Promise<void> {
  await adminAPI.post('/sandbox/sweep', {}, SweepSchema);
  await sandboxStore.getState().refresh();
}

async function setTTL(seconds: number): Promise<void> {
  await adminAPI.postVoid('/sandbox/ttl', { seconds });
}
