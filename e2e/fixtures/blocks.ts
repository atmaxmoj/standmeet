// blocks.ts —— API contract for the Phase H admin "blocks" panel
// (block_enabled enable/disable + origin + delete only for owner-origin).
// The backend implementation lands in Phase H; before that these calls get
// 404/405 → the H tests are red (T.0).
//
// Contract (decision points P.5/P.6/P.7):
//   GET    /api/admin/blocks          → list all block+supplier+skill
//   PATCH  /api/admin/blocks/{id}      → {enabled} toggle (builtin can be disabled, not deleted)
//   DELETE /api/admin/blocks/{id}      → only owner-origin can delete, otherwise 4xx

import type { APIRequestContext } from '@playwright/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

type BlockOrigin = 'builtin' | 'managed' | 'owner';
type BlockKind = 'block' | 'supplier' | 'skill';

export interface BlockRow {
  id: string;
  origin: BlockOrigin;
  enabled: boolean;
  kind: BlockKind;
  deletable: boolean;
  // The supplier this depends on (e.g. calendar.book needs Google Calendar);
  // not connected → connected:false.
  dependency?: { name: string; connected: boolean };
}

export async function listBlocks(
  request: APIRequestContext, csrf: string,
): Promise<BlockRow[]> {
  const res = await request.get(`${BACKEND}/api/admin/blocks`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (res.status() !== 200) throw new Error(`list blocks: ${res.status()}`);
  return (await res.json() as { blocks: BlockRow[] }).blocks;
}

export async function findBlock(
  request: APIRequestContext, csrf: string, id: string,
): Promise<BlockRow | undefined> {
  return (await listBlocks(request, csrf)).find((c) => c.id === id);
}

/** Toggle a block's owner-enable flag. Returns the HTTP status so
 *  callers can assert both success (200) and rejection paths. */
export async function setBlockEnabled(
  request: APIRequestContext, csrf: string, id: string, enabled: boolean,
): Promise<number> {
  const res = await request.patch(
    `${BACKEND}/api/admin/blocks/${encodeURIComponent(id)}`,
    { data: { enabled }, headers: { 'X-Csrftoken': csrf } },
  );
  return res.status();
}

/** Delete a block. Only owner-origin should succeed; builtin/managed
 *  must be rejected. Returns the HTTP status. */
export async function deleteBlock(
  request: APIRequestContext, csrf: string, id: string,
): Promise<number> {
  const res = await request.delete(
    `${BACKEND}/api/admin/blocks/${encodeURIComponent(id)}`,
    { headers: { 'X-Csrftoken': csrf } },
  );
  return res.status();
}

// ─── visitor tool-spec inspection (operator diag endpoint) ──────

/** Tool names assembled into a visitor session — used to assert a
 *  block's tools appear/disappear as it's enabled/disabled. */
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
