// block-delete-relied-refused.spec.ts — item 32: deleting a block a fiber relies on is refused,
// the dependent named. Delete is destructive and irreversible (it drops the block's schema), so a
// block relied upon must not be removable while a consumer requires the seam it provides — removing
// it would leave that consumer with an unmet dependency and no way back. This is stronger than the
// relied-lock on the *disable* toggle (block-relied-lock.spec.ts): disable is a reversible switch,
// delete is not, so the backend refuses it outright and names the block that relies on it.
//
// Black-box over the real owner API (the destructive edge ops run over the MCP/API too, with the
// same reaction — everything-is-a-block-tests.md). RED-first: before the guard, DELETE returns 200
// and the provider is gone; after, it is refused (4xx), names the consumer, and the provider stays.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { findBlock } from '@/fixtures/blocks';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'delete-relied@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'deleterelied',
  fullName: 'Delete Relied Owner',
};

function manifest(id: string, provides: string, requires?: string): string {
  const lines = [`id: ${id}`, `title: ${id}`, 'version: "1"', `provides: ${provides}`];
  if (requires) lines.push('requires:', `  - ${requires}`);
  return lines.join('\n');
}

async function install(request: APIRequestContext, csrf: string, m: string): Promise<void> {
  // eslint-disable-next-line e2e-local/no-direct-mutating-api -- fixture setup: install blocks
  const res = await request.post(`${BACKEND}/api/admin/blocks`, {
    headers: { 'X-Csrftoken': csrf }, data: { manifest: m },
  });
  expect(res.status(), await res.text()).toBe(201);
}

async function del(request: APIRequestContext, csrf: string, id: string) {
  // item 32 IS the API-refusal path: the destructive op run over the owner API (the GUI path — a
  // disabled delete button — is covered by block-relied-lock.spec.ts). We need the response body to
  // assert the dependent is named, which the status-only deleteBlock fixture cannot give.
  // eslint-disable-next-line e2e-local/no-direct-mutating-api -- deliberate direct API: see above
  const res = await request.delete(
    `${BACKEND}/api/admin/blocks/${encodeURIComponent(id)}`,
    { headers: { 'X-Csrftoken': csrf } },
  );
  return { status: res.status(), text: await res.text() };
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('a relied-upon block cannot be deleted (item 32)', () => {
  let request: APIRequestContext;
  let csrf: string;

  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    resetInstance();
    request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    ({ csrf } = await loginAPI(request, OWNER.email, OWNER.password));
    await install(request, csrf, manifest('drprovider', 'drseam'));
    await install(request, csrf, manifest('drconsumer', 'drapp', 'drseam'));
  });

  test.afterAll(async () => { await request.dispose(); });

  test('deleting the relied-upon provider is refused and names the consumer', async () => {
    const res = await del(request, csrf, 'drprovider');
    expect(res.status, res.text).toBeGreaterThanOrEqual(400);
    expect(res.status, res.text).toBeLessThan(500);
    // The refusal names the block that relies on it — a user-friendly reason, not a stack trace.
    expect(res.text).toContain('drconsumer');
    // The provider is still installed: the refusal did not half-delete it.
    expect(await findBlock(request, csrf, 'drprovider')).toBeTruthy();
  });

  test('the consumer (nothing relies on it) still deletes cleanly', async () => {
    // Precision: the guard refuses only what is relied upon. The leaf consumer deletes,
    // and once it is gone the provider is no longer relied upon and can be deleted too.
    expect((await del(request, csrf, 'drconsumer')).status).toBe(200);
    expect(await findBlock(request, csrf, 'drconsumer')).toBeFalsy();
    expect((await del(request, csrf, 'drprovider')).status).toBe(200);
    expect(await findBlock(request, csrf, 'drprovider')).toBeFalsy();
  });
});
