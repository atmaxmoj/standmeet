// use-mcp-servers —— owner-registered external MCP servers (tools the agent
// calls outbound). Used by RoleCreateModal's multiselect list; ApiSection's
// MCPServersPanel does CRUD. Backend GET/POST/DELETE /mcp-servers are all
// real; the auth header value is encrypted at rest and never returned in the
// view. POST /mcp-servers/{id}/check is a read-only probe: dial once, list
// tools once, tear down (F-D-8).

import { useEffect } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

export const MCPServerViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  auth_header_name: z.string().optional().default(''),
  created_at: z.string().optional().default(''),
});
export type MCPServerView = z.infer<typeof MCPServerViewSchema>;

export interface CreateMCPServerInput {
  name: string;
  url: string;
  auth_header_name?: string;
  auth_header_value?: string;
}

// MCPProbeSchema —— the probe's receipt: **a list of tool names**.
// The backend gives names rather than a count, because what the owner needs to recognize is "is this the server I meant to attach".
export const MCPProbeSchema = z.object({
  tools: z.array(z.string()).nullish().transform((v) => v ?? []),
});
export type MCPProbe = z.infer<typeof MCPProbeSchema>;

export interface MCPServersHook {
  status: ResourceStatus;
  servers: readonly MCPServerView[];
  error: string | null;
  refresh: () => Promise<void>;
  create: (input: CreateMCPServerInput) => Promise<{ ok: boolean; error?: string }>;
  remove: (id: string) => Promise<void>;
  check: (id: string) => Promise<MCPProbe>;
}

export const mcpServersStore = createResourceStore<MCPServerView[]>({
  name: 'mcp-servers',
  fetcher: () => adminAPI.get('/mcp-servers/', z.array(MCPServerViewSchema)),
});

export function useMCPServers(): MCPServersHook {
  const r = useResource(mcpServersStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return {
    status: r.status,
    servers: r.data ?? [],
    error: r.error,
    refresh: mcpServersStore.getState().refresh,
    create: createServer,
    remove: removeServer,
    check: checkServer,
  };
}

// checkServer —— pings that server. **Throws** (not swallowed into a fake
// answer): "unreachable" and "reachable but no tools" are two different
// things to the owner, and both must not display as 0 tools.
async function checkServer(id: string): Promise<MCPProbe> {
  return adminAPI.post(`/mcp-servers/${id}/check`, {}, MCPProbeSchema);
}

async function createServer(
  input: CreateMCPServerInput,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await adminAPI.post('/mcp-servers/', input, MCPServerViewSchema);
    await mcpServersStore.getState().refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not add MCP server' };
  }
}

// remove throws (no longer swallowed into false): the caller finishes up with useAction (success toast / failure report).
async function removeServer(id: string): Promise<void> {
  await adminAPI.deleteVoid(`/mcp-servers/${id}`);
  await mcpServersStore.getState().refresh();
}
