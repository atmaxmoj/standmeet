// app-state.ts —— MCP App 跨刷新状态原语的 CRUD 客户端（访客 session 视角）。
// 卡经 host 调的就是这套 endpoint；mcp_id 由后端从 {tool} 推出（不收客户端 mcp_id）。
// 用 bare request（独立 APIRequestContext）+ Bearer session token，跟卡同一条鉴权路径。

import type { APIRequestContext } from '@playwright/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

function base(conv: string, tool: string): string {
  return `${BACKEND}/api/v1/sessions/${conv}/app-state/${tool}`;
}

// putAppState —— 写一格 {tool→mcp}[key]=value。返回 HTTP status（隔离/鉴权断言用）。
export async function putAppState(
  request: APIRequestContext, token: string,
  conv: string, tool: string, key: string, value: unknown,
): Promise<number> {
  const res = await request.put(`${base(conv, tool)}/${key}`, {
    headers: { Authorization: `Bearer ${token}` }, data: { value },
  });
  return res.status();
}

// getAppState —— 读该 tool 所属 mcp 的整格 {key: value}。
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

// deleteAppState —— 删一个 key。
export async function deleteAppState(
  request: APIRequestContext, token: string,
  conv: string, tool: string, key: string,
): Promise<number> {
  const res = await request.delete(`${base(conv, tool)}/${key}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.status();
}
