// app-state.ts —— CRUD client for the MCP App cross-refresh state primitive
// (from the visitor session's point of view). This is the same endpoint the
// card calls via the host; mcp_id is derived by the backend from {tool} (no
// client-supplied mcp_id). Uses a bare request (a standalone APIRequestContext)
// + Bearer session token, the same auth path the card uses.

import type { APIRequestContext } from '@playwright/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

function base(conv: string, tool: string): string {
  return `${BACKEND}/api/v1/sessions/${conv}/app-state/${tool}`;
}

// putAppState —— write one cell {tool→mcp}[key]=value. Returns the HTTP status
// (for isolation / auth assertions).
export async function putAppState(
  request: APIRequestContext, token: string,
  conv: string, tool: string, key: string, value: unknown,
): Promise<number> {
  const res = await request.put(`${base(conv, tool)}/${key}`, {
    headers: { Authorization: `Bearer ${token}` }, data: { value },
  });
  return res.status();
}

// getAppState —— read the whole {key: value} cell of the mcp this tool belongs to.
export async function getAppState(
  request: APIRequestContext, token: string, conv: string, tool: string,
): Promise<Record<string, unknown>> {
  const res = await request.get(base(conv, tool), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status() !== 200) return {};
  const body = await res.json() as { state?: Record<string, unknown> };
  return body.state ?? {};
}

// deleteAppState —— delete one key.
export async function deleteAppState(
  request: APIRequestContext, token: string,
  conv: string, tool: string, key: string,
): Promise<number> {
  const res = await request.delete(`${base(conv, tool)}/${key}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.status();
}
