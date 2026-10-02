// bundles.ts — seed and remove the owner's bundles (a named list of blocks a code can bind to).
//
// Seeding goes through the admin API, as every owner-side fixture does; the specs drive what a
// visitor and the owner see on top of it.

import { createHash } from 'node:crypto';

import type { APIRequestContext } from '@playwright/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

export interface Bundle { id: string; name: string; blocks: string[] }

/** Create a bundle holding `blocks`; returns it with its id. */
export async function createBundle(
  request: APIRequestContext, csrf: string, name: string, blocks: readonly string[],
): Promise<Bundle> {
  const res = await request.post(`${BACKEND}/api/admin/bundles`, {
    headers: { 'X-Csrftoken': csrf }, data: { name, blocks: [...blocks], include_bundles: [] },
  });
  if (res.status() !== 201) throw new Error(`create bundle ${name}: ${res.status()} ${await res.text()}`);
  return await res.json() as Bundle;
}

/** Delete a bundle by id (the admin panel's delete). */
export async function deleteBundleByID(
  request: APIRequestContext, csrf: string, bundleID: string,
): Promise<void> {
  const res = await request.post(`${BACKEND}/api/admin/bundles/${bundleID}/delete`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (res.status() !== 200 && res.status() !== 204) {
    throw new Error(`delete bundle ${bundleID}: ${res.status()} ${await res.text()}`);
  }
}

/** The schema a bundle's fiber of `blockID` stores in: mcp_b_<bundle>_<block>. */
export function bundleSchema(bundleID: string, blockID: string): string {
  return schemaName(`b_${bundleID}_${blockID}`);
}

/** The schema an owner's no-bundle (root) fiber of `blockID` stores in. */
export function rootSchema(ownerID: string, blockID: string): string {
  return schemaName(`root_${ownerID}_${blockID}`);
}

// schemaName — blockstore's derivation: [^a-z0-9] runs → '_', and a name over Postgres's 63 bytes
// keeps its first 54 bytes plus 8 hex of the whole name's sha256 (blockstore/schema.go fitSchemaName).
function schemaName(id: string): string {
  const name = `mcp_${id.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;
  if (name.length <= 63) return name;
  const hash = createHash('sha256').update(name).digest('hex').slice(0, 8);
  return `${name.slice(0, 54).replace(/_+$/, '')}_${hash}`;
}
