// use-mcp-servers —— owner-registered external MCP servers 列表。RoleCreateModal
// 用它列 multiselect。当前只读，CRUD 走 connectors / api·mcp 那条路。

import { useEffect } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, readResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

export const MCPServerViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
});
export type MCPServerView = z.infer<typeof MCPServerViewSchema>;

export interface MCPServersHook {
  status: ResourceStatus;
  servers: readonly MCPServerView[];
  error: string | null;
  refresh: () => Promise<void>;
}

export const mcpServersStore = createResourceStore<MCPServerView[]>({
  name: 'mcp-servers',
  fetcher: () => adminAPI.get('/mcp-servers/', z.array(MCPServerViewSchema)),
});

export function useMCPServers(): MCPServersHook {
  const r = readResource(mcpServersStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return {
    status: r.status,
    servers: r.data ?? [],
    error: r.error,
    refresh: mcpServersStore.getState().refresh,
  };
}
