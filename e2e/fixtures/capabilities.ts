// capabilities.ts —— Phase H admin「能力」面板的 API 契约（capability_settings
// enable/disable + origin + 删除仅 owner-origin）。后端实现 land 在 Phase H；
// 在那之前这些调用拿 404/405 → H 测试红（T.0）。
//
// 契约（决策点 P.5/P.6/P.7）：
//   GET    /api/admin/capabilities          → 列全部 capability+connector+skill
//   PATCH  /api/admin/capabilities/{id}      → {enabled} 开关（builtin 可关不可删）
//   DELETE /api/admin/capabilities/{id}      → 仅 owner-origin 可删，否则 4xx

import type { APIRequestContext } from '@playwright/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

type CapabilityOrigin = 'builtin' | 'managed' | 'owner';
type CapabilityKind = 'capability' | 'connector' | 'skill';

export interface CapabilityRow {
  id: string;
  origin: CapabilityOrigin;
  enabled: boolean;
  kind: CapabilityKind;
  deletable: boolean;
  // 依赖的 connector（如 calendar.book 需 Google Calendar）；未连 → connected:false。
  dependency?: { name: string; connected: boolean };
}

export async function listCapabilities(
  request: APIRequestContext, csrf: string,
): Promise<CapabilityRow[]> {
  const res = await request.get(`${BACKEND}/api/admin/capabilities`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (res.status() !== 200) throw new Error(`list capabilities: ${res.status()}`);
  return (await res.json() as { capabilities: CapabilityRow[] }).capabilities;
}

export async function findCapability(
  request: APIRequestContext, csrf: string, id: string,
): Promise<CapabilityRow | undefined> {
  return (await listCapabilities(request, csrf)).find((c) => c.id === id);
}

/** Toggle a capability's owner-enable flag. Returns the HTTP status so
 *  callers can assert both success (200) and rejection paths. */
export async function setCapabilityEnabled(
  request: APIRequestContext, csrf: string, id: string, enabled: boolean,
): Promise<number> {
  const res = await request.patch(
    `${BACKEND}/api/admin/capabilities/${encodeURIComponent(id)}`,
    { data: { enabled }, headers: { 'X-Csrftoken': csrf } },
  );
  return res.status();
}

/** Delete a capability. Only owner-origin should succeed; builtin/managed
 *  must be rejected. Returns the HTTP status. */
export async function deleteCapability(
  request: APIRequestContext, csrf: string, id: string,
): Promise<number> {
  const res = await request.delete(
    `${BACKEND}/api/admin/capabilities/${encodeURIComponent(id)}`,
    { headers: { 'X-Csrftoken': csrf } },
  );
  return res.status();
}

// ─── visitor tool-spec inspection (operator diag endpoint) ──────

/** Tool names assembled into a visitor session — used to assert a
 *  capability's tools appear/disappear as it's enabled/disabled. */
export async function sessionToolNames(
  request: APIRequestContext, sessionToken: string,
): Promise<string[]> {
  const res = await request.get(`${BACKEND}/internal/diag/session`, {
    headers: { 'X-Session-Token': sessionToken },
  });
  if (res.status() !== 200) throw new Error(`diag session: ${res.status()}`);
  const body = await res.json() as { tool_specs: readonly { name: string }[] };
  return body.tool_specs.map((t) => t.name);
}
