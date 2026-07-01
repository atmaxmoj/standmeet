// use-mcp-servers —— owner-registered external MCP servers(agent 出站调的工具)。
// RoleCreateModal 列 multiselect 用;ApiSection 的 MCPServersPanel 做 CRUD。
// 后端 GET/POST/DELETE /mcp-servers 全 real;auth header value 落盘加密,view 不回。

import { useEffect } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, readResource } from '@/lib/state/create-resource-store';
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

export interface MCPServersHook {
  status: ResourceStatus;
  servers: readonly MCPServerView[];
  error: string | null;
  refresh: () => Promise<void>;
  create: (input: CreateMCPServerInput) => Promise<{ ok: boolean; error?: string }>;
  remove: (id: string) => Promise<void>;
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
    create: createServer,
    remove: removeServer,
  };
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

// remove 抛错（不再吞成 false）：调用方用 useAction 收尾（成功 toast / 失败 report）。
async function removeServer(id: string): Promise<void> {
  await adminAPI.deleteVoid(`/mcp-servers/${id}`);
  await mcpServersStore.getState().refresh();
}
