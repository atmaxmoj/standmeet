// use-mcp-servers —— owner-registered external MCP servers(agent 出站调的工具)。
// RoleCreateModal 列 multiselect 用;ApiSection 的 MCPServersPanel 做 CRUD。
// 后端 GET/POST/DELETE /mcp-servers 全 real;auth header value 落盘加密,view 不回。
// POST /mcp-servers/{id}/check 是只读探针:拨一次、列一次工具、挂掉(F-D-8)。

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

// MCPProbeSchema —— 探针的回执:**工具名的清单**。
// 后端给的是名字而不是数量,因为 owner 要认的是「这是不是我想挂的那一台」。
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

// checkServer —— 去问那台 server 一句。**抛错**(不吞成一个假答案):够不着跟
// 「够得着但没有工具」在 owner 眼里是两回事,不能都显示成 0 tools。
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

// remove 抛错（不再吞成 false）：调用方用 useAction 收尾（成功 toast / 失败 report）。
async function removeServer(id: string): Promise<void> {
  await adminAPI.deleteVoid(`/mcp-servers/${id}`);
  await mcpServersStore.getState().refresh();
}
