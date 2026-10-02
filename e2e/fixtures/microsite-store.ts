// microsite-store.ts —— the owner's side of a page's data store, through the admin routes the
// admin panel uses: open it to writes, set its policy (limit, review), list, approve, delete.

import type { APIRequestContext } from '@playwright/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

export interface StoredDoc {
  id: string;
  collection: string;
  doc: Record<string, unknown>;
}

async function ok(res: { status: () => number; text: () => Promise<string> }, what: string): Promise<void> {
  if (res.status() < 200 || res.status() >= 300) throw new Error(`${what}: ${res.status()} ${await res.text()}`);
}

/** Open or close the page's store to visitor (and agent) writes. */
export async function setStoreWritable(
  request: APIRequestContext, csrf: string, slug: string, writable: boolean,
): Promise<void> {
  await ok(await request.put(`${BACKEND}/api/admin/microsites/${slug}/store-writable`, {
    headers: { 'X-Csrftoken': csrf }, data: { store_writable: writable },
  }), 'set store writable');
}

/** The page's store policy: how many documents it may hold, and whether a new one waits for review. */
export async function setStorePolicy(
  request: APIRequestContext, csrf: string, slug: string,
  policy: { max_docs?: number; review?: boolean },
): Promise<void> {
  await ok(await request.put(`${BACKEND}/api/admin/microsites/${slug}/store-policy`, {
    headers: { 'X-Csrftoken': csrf }, data: policy,
  }), 'set store policy');
}

/** Every document the page holds (owner view, newest first, pending ones included). */
export async function listStoreDocs(
  request: APIRequestContext, csrf: string, slug: string,
): Promise<StoredDoc[]> {
  const res = await request.get(`${BACKEND}/api/admin/microsites/${slug}/store?limit=200`, {
    headers: { 'X-Csrftoken': csrf },
  });
  await ok(res, 'list store docs');
  return ((await res.json()) as { items: StoredDoc[] }).items;
}

/** A visitor's write through the public store route (a page that opens without a code). */
export async function writeStoreDoc(
  request: APIRequestContext, slug: string, collection: string, doc: Record<string, unknown>,
): Promise<{ id: string; pending: boolean }> {
  const res = await request.post(`${BACKEND}/api/v1/pages/${slug}/store`, { data: { collection, doc } });
  await ok(res, 'write store doc');
  return await res.json() as { id: string; pending: boolean };
}

/** Publish a document that waits for review. */
export async function approveStoreDoc(
  request: APIRequestContext, csrf: string, slug: string, d: StoredDoc,
): Promise<void> {
  await ok(await request.post(
    `${BACKEND}/api/admin/microsites/${slug}/store/${d.collection}/${d.id}/approve`,
    { headers: { 'X-Csrftoken': csrf } },
  ), 'approve store doc');
}

/** Remove one document. */
export async function deleteStoreDoc(
  request: APIRequestContext, csrf: string, slug: string, d: StoredDoc,
): Promise<void> {
  await ok(await request.delete(`${BACKEND}/api/admin/microsites/${slug}/store/${d.collection}/${d.id}`, {
    headers: { 'X-Csrftoken': csrf },
  }), 'delete store doc');
}
