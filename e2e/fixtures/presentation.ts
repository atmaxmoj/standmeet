// presentation.ts —— shared helpers for the owner-CSS / cssclasses three-surface
// editing tests (vault-sync / admin UI / MCP).
// Intended interfaces (none exist yet → RED):
//   admin UI: PUT/GET /api/admin/appearance/css   (owner-level CSS blob; sanitized + scoped at store time)
//   MCP:      tools/call set_owner_css {css}
//   sync:     harvest .obsidian/snippets/*.css (enabled per appearance.json) → the same place

import type { APIRequestContext } from '@playwright/test';

import { createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { initMCP, callTool } from '@/fixtures/mcp';
import { BACKEND, type SyncOwner } from '@/fixtures/vault-sync';

const APPEARANCE_CSS_URL = `${BACKEND}/api/admin/appearance/css`;

// adminSetCSS —— the owner stores a piece of CSS from the admin UI. Returns the
// HTTP status (RED: 404 until the route is built).
export async function adminSetCSS(
  request: APIRequestContext, owner: SyncOwner, css: string,
): Promise<number> {
  const { csrf } = await loginAPI(request, owner.email, owner.password);
  const res = await request.put(APPEARANCE_CSS_URL, {
    headers: { 'X-Csrftoken': csrf }, data: { css },
  });
  return res.status();
}

// adminGetCSS —— fetch the stored owner CSS (should be the sanitized + scoped safe version).
export async function adminGetCSS(request: APIRequestContext, owner: SyncOwner): Promise<string> {
  const { csrf } = await loginAPI(request, owner.email, owner.password);
  const res = await request.get(APPEARANCE_CSS_URL, { headers: { 'X-Csrftoken': csrf } });
  if (res.status() !== 200) return '';
  const body = await res.json() as { css?: string };
  return body.css ?? '';
}

// mcpSetCSS —— the owner's AI sets CSS via an MCP tool.
export async function mcpSetCSS(
  request: APIRequestContext, owner: SyncOwner, css: string,
): Promise<void> {
  const { csrf } = await loginAPI(request, owner.email, owner.password);
  const token = await createAPIToken(request, csrf, `css-mcp-${owner.handle}`);
  const sid = await initMCP(request, token);
  await callTool(request, token, sid, 'set_owner_css', { css });
}
