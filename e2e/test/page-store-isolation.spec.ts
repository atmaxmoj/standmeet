// page-store-isolation.spec.ts — the per-custom-page persistence store's security invariants.
//
// The owner flagged this store as the error-prone part ("很容易存储泄漏" + "招惹外部攻击" + "想足
// 场景做测试"). Each test here is one of those scenarios, driven end to end through the real public
// endpoint (POST/GET /api/v1/pages/{slug}/store) and the owner's MCP toggle:
//
//   - write gate (model C): a page rejects writes until its owner opens it (store_writable);
//   - isolation: page A's data never appears in page B's store (separate per-page schemas);
//   - no leak on delete: deleting a page drops its schema — its store becomes gone (404);
//   - doc-size cap: an over-size document is refused;
//   - unknown page: writing to a slug that doesn't exist is refused, not silently accepted.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';

const OWNER = {
  email: 'pagestore@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'pagestore',
  fullName: 'Page Store Owner',
};

interface WriteResult {
  id: string;
}
interface QueryResult {
  docs: Array<Record<string, unknown>>;
}

// storeURL — the visitor endpoint for a page's store. Same-origin /api/v1, no auth (a visitor).
function storeURL(slug: string, collection?: string): string {
  const base = `/api/v1/pages/${slug}/store`;
  return collection === undefined ? base : `${base}?collection=${collection}`;
}

async function openStore(
  request: APIRequestContext, token: string, sid: string, slug: string,
): Promise<void> {
  await callTool(request, token, sid, 'custom_page.set_store_writable', {
    slug, store_writable: true,
  });
}

// writeGateFlow — closed → 403; owner opens it → the same write is accepted and reads back.
async function writeGateFlow(request: APIRequestContext, token: string, sid: string): Promise<void> {
  const closed = await request.post(storeURL('store-a'), {
    data: { collection: 'votes', doc: { choice: 'x' } },
  });
  expect(closed.status(), 'writes are off until the owner opens the store').toBe(403);

  await openStore(request, token, sid, 'store-a');
  const ok = await request.post(storeURL('store-a'), {
    data: { collection: 'votes', doc: { choice: 'x' } },
  });
  expect(ok.status(), 'an opened store accepts the write').toBe(200);
  expect(((await ok.json()) as WriteResult).id, 'the write returns a document id').toBeTruthy();

  const read = await request.get(storeURL('store-a', 'votes'));
  expect(read.status()).toBe(200);
  expect(((await read.json()) as QueryResult).docs, 'the document reads back')
    .toContainEqual({ choice: 'x' });
}

async function ownerSession(request: APIRequestContext): Promise<{ token: string; sid: string }> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'pagestore');
  const sid = await initMCP(request, token);
  return { token, sid };
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('per-page store · isolation + write gate + no-leak', () => {
  let token = '';
  let sid = '';

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    ({ token, sid } = await ownerSession(request));
    // Two pages up front; neither built (the store doesn't need a build, only the page row).
    await callTool(request, token, sid, 'custom_page.create', { slug: 'store-a', title: 'A' });
    await callTool(request, token, sid, 'custom_page.create', { slug: 'store-b', title: 'B' });
    await request.dispose();
  });

  test('a closed page rejects writes (model C, default off); opening it lets the write through',
    ({ request }) => writeGateFlow(request, token, sid));

  test('one page cannot see another page\'s data (separate per-page schemas)',
    async ({ request }) => {
      await openStore(request, token, sid, 'store-a');
      await request.post(storeURL('store-a'), {
        data: { collection: 'votes', doc: { secret: 'A-only' } },
      });
      // store-b's collection with the SAME name must not surface store-a's rows.
      const b = await request.get(storeURL('store-b', 'votes'));
      expect(b.status()).toBe(200);
      const { docs } = (await b.json()) as QueryResult;
      expect(docs, 'store-b sees none of store-a\'s data').not.toContainEqual({ secret: 'A-only' });
    });

  test('deleting a page drops its data with the schema (its store becomes gone)',
    async ({ request }) => {
      await callTool(request, token, sid, 'custom_page.create', { slug: 'store-gone', title: 'G' });
      await openStore(request, token, sid, 'store-gone');
      await request.post(storeURL('store-gone'), {
        data: { collection: 'notes', doc: { leak: 'should-vanish' } },
      });
      const before = await request.get(storeURL('store-gone', 'notes'));
      expect(((await before.json()) as QueryResult).docs, 'the doc is there first').toHaveLength(1);

      // Delete the page → DROP SCHEMA CASCADE takes the data with it.
      await callTool(request, token, sid, 'custom_page.delete', { slug: 'store-gone' });

      // The page — and its store — are gone: a read on it is a clean 404, not the old data.
      const after = await request.get(storeURL('store-gone', 'notes'));
      expect(after.status(), 'a deleted page\'s store is gone, not still serving its rows').toBe(404);
    });

  test('an over-size document is refused', async ({ request }) => {
    await openStore(request, token, sid, 'store-a');
    const huge = 'x'.repeat(9 * 1024); // > the 8KB per-doc cap
    const res = await request.post(storeURL('store-a'), {
      data: { collection: 'votes', doc: { blob: huge } },
    });
    expect(res.status(), 'a document past the size cap is rejected').toBe(400);
  });

  test('writing to a page that does not exist is refused', async ({ request }) => {
    const res = await request.post(storeURL('no-such-page'), {
      data: { collection: 'votes', doc: { x: 1 } },
    });
    expect(res.status(), 'an unknown page is not a silent success').toBeGreaterThanOrEqual(400);
  });
});
