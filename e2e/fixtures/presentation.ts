// presentation.ts —— owner-CSS / cssclasses 三面编辑(vault-sync / admin UI / MCP)测试的共享 helpers。
// 意图态接口(现在都不存在 → RED):
//   admin UI: PUT/GET /api/admin/appearance/css   （owner-级 CSS blob;store 时 sanitize + scope）
//   MCP:      tools/call set_owner_css {css}
//   sync:     harvest .obsidian/snippets/*.css（按 appearance.json 启用）→ 同一处

import type { APIRequestContext } from '@playwright/test';

import { createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { initMCP, callTool } from '@/fixtures/mcp';
import { BACKEND, type SyncOwner } from '@/fixtures/vault-sync';

const APPEARANCE_CSS_URL = `${BACKEND}/api/admin/appearance/css`;

// adminSetCSS —— owner 从 admin UI 存一段 CSS。返回 HTTP status(RED: 404 直到路由建好)。
export async function adminSetCSS(
  request: APIRequestContext, owner: SyncOwner, css: string,
): Promise<number> {
  const { csrf } = await loginAPI(request, owner.email, owner.password);
  const res = await request.put(APPEARANCE_CSS_URL, {
    headers: { 'X-Csrftoken': csrf }, data: { css },
  });
  return res.status();
}

// adminGetCSS —— 取存下来的 owner CSS(应是 sanitize + scope 之后的安全版本)。
export async function adminGetCSS(request: APIRequestContext, owner: SyncOwner): Promise<string> {
  const { csrf } = await loginAPI(request, owner.email, owner.password);
  const res = await request.get(APPEARANCE_CSS_URL, { headers: { 'X-Csrftoken': csrf } });
  if (res.status() !== 200) return '';
  const body = await res.json() as { css?: string };
  return body.css ?? '';
}

// mcpSetCSS —— owner 的 AI 通过 MCP 工具设 CSS。
export async function mcpSetCSS(
  request: APIRequestContext, owner: SyncOwner, css: string,
): Promise<void> {
  const { csrf } = await loginAPI(request, owner.email, owner.password);
  const token = await createAPIToken(request, csrf, `css-mcp-${owner.handle}`);
  const sid = await initMCP(request, token);
  await callTool(request, token, sid, 'set_owner_css', { css });
}
