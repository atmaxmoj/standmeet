// keypair.ts —— Phase C: admin REST helpers for owner_keypairs.
//
// POST /api/admin/keypairs → 一次性返 {keyId, privateKeyPem}
// GET  /api/admin/keypairs → list metadata only (无 pem，无 hash)
// DELETE /api/admin/keypairs/:keyId → hard delete (= revoke)

import type { APIRequestContext } from '@playwright/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

export interface CreatedKeypair {
  key_id: string;
  private_key_pem: string;
  label: string;
  created_at: string;
}

export interface KeypairView {
  key_id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
}

export async function createKeypair(
  request: APIRequestContext, csrf: string, label: string,
): Promise<CreatedKeypair> {
  const res = await request.post(`${BACKEND}/api/admin/keypairs`, {
    headers: { 'X-Csrftoken': csrf },
    data: { label },
  });
  if (res.status() !== 201) {
    throw new Error(`create keypair: ${res.status()} ${await res.text()}`);
  }
  return await res.json() as CreatedKeypair;
}

export async function listKeypairs(
  request: APIRequestContext, csrf: string,
): Promise<KeypairView[]> {
  const res = await request.get(`${BACKEND}/api/admin/keypairs`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (res.status() !== 200) throw new Error(`list keypairs: ${res.status()}`);
  return await res.json() as KeypairView[];
}

export async function deleteKeypair(
  request: APIRequestContext, csrf: string, keyID: string,
): Promise<void> {
  const res = await request.delete(`${BACKEND}/api/admin/keypairs/${keyID}`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (res.status() !== 204) {
    throw new Error(`delete keypair: ${res.status()} ${await res.text()}`);
  }
}
