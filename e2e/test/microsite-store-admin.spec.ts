// microsite-store-admin.spec.ts —— the owner's management view of a microsite's data store
// (Resources → Data). The store's write gate + isolation are covered in
// microsite-store-isolation.spec.ts; this covers the admin management routes added for the
// Data section: list every document, delete one by (collection, record_id), and clear the store.
//
// Visitor writes go in through the real public endpoint; the owner reads/deletes them through
// /api/admin/microsites/{slug}/store — end to end through the real DB.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login as loginAPI, createAPIToken } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'storeadmin@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'storeadmin',
  fullName: 'Store Admin Owner',
};

interface StoreDoc { id: string; collection: string; doc: Record<string, unknown> }
interface StoreDocs { slug: string; docs: StoreDoc[] }

let csrf = '';
let token = '';
let sid = '';
let ctx: APIRequestContext;

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('microsite data store · admin management', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
    ctx = await playwright.request.newContext();
    ({ csrf } = await loginAPI(ctx, OWNER.email, OWNER.password));
    token = await createAPIToken(ctx, csrf, 'store-admin');
    sid = await initMCP(ctx, token);
    await callTool(ctx, token, sid, 'microsite.create', { slug: 'poll', title: 'Poll' });
    await callTool(ctx, token, sid, 'microsite.set_store_writable', {
      slug: 'poll', store_writable: true,
    });
  });

  test('list shows visitor writes; delete-one and clear remove them', async () => {
    // an empty store is a clean [] (schema may not be provisioned yet), not an error
    expect((await listDocs('poll')).docs, 'empty store lists no docs').toHaveLength(0);

    await visitorWrite('poll', 'votes', { choice: 'a' });
    await visitorWrite('poll', 'votes', { choice: 'b' });
    const two = await listDocs('poll');
    expect(two.docs, 'both visitor writes are listed').toHaveLength(2);
    expect(two.docs.map((d) => d.doc['choice']).sort()).toEqual(['a', 'b']);
    expect(two.docs.every((d) => d.collection === 'votes')).toBe(true);

    // delete one document by (collection, record_id) → one remains
    const del = await deleteDoc('poll', two.docs[0]!.collection, two.docs[0]!.id);
    expect(del.status()).toBe(200);
    const one = await listDocs('poll');
    expect(one.docs, 'one document remains').toHaveLength(1);
    expect(one.docs[0]!.id, 'the other one, specifically').toBe(two.docs[1]!.id);

    // clear the whole store → empty
    const cleared = await clearStore('poll');
    expect(cleared.status()).toBe(200);
    expect((await listDocs('poll')).docs, 'store is empty after clear').toHaveLength(0);
  });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}

async function visitorWrite(
  slug: string, collection: string, doc: Record<string, unknown>,
): Promise<void> {
  const res = await ctx.post(`${BACKEND}/api/v1/pages/${slug}/store`, { data: { collection, doc } });
  expect(res.status(), 'an opened store accepts the visitor write').toBe(200);
}

async function listDocs(slug: string): Promise<StoreDocs> {
  const res = await ctx.get(`${BACKEND}/api/admin/microsites/${slug}/store`, {
    headers: { 'X-Csrftoken': csrf },
  });
  expect(res.status()).toBe(200);
  return res.json() as Promise<StoreDocs>;
}

function deleteDoc(slug: string, collection: string, recordID: string) {
  return ctx.delete(`${BACKEND}/api/admin/microsites/${slug}/store/${collection}/${recordID}`, {
    headers: { 'X-Csrftoken': csrf },
  });
}

function clearStore(slug: string) {
  return ctx.delete(`${BACKEND}/api/admin/microsites/${slug}/store`, {
    headers: { 'X-Csrftoken': csrf },
  });
}
