// capabilities.ts —— API contract for the Phase H admin "capabilities" panel
// (capability_settings enable/disable + origin + delete only for owner-origin).
// The backend implementation lands in Phase H; before that these calls get
// 404/405 → the H tests are red (T.0).
//
// Contract (decision points P.5/P.6/P.7):
//   GET    /api/admin/capabilities          → list all capability+connector+skill
//   PATCH  /api/admin/capabilities/{id}      → {enabled} toggle (builtin can be disabled, not deleted)
//   DELETE /api/admin/capabilities/{id}      → only owner-origin can delete, otherwise 4xx

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
  // The connector this depends on (e.g. calendar.book needs Google Calendar);
  // not connected → connected:false.
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
