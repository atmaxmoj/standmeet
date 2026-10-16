// new-code-same-name.spec.ts —— BLACK BOX. A visitor whose old code session has ended opens a NEW
// code and types the same name as before: they get a session on the new code.
//
// Found on sijie.xyz (2026-10-16, owner: "我刚建立了一个code给我自己用，不知道为什么超时了"): the name
// picker read "same name as the stored session" as "continue that chat" without asking whether that
// session was on THIS code. It skipped the issue; the stored session (other code, already ended)
// probed 401; the dead-session cleanup rescued the OLD code over the new one; the old code was
// refused, and the visitor dropped to the public tier on the public model.
//
// Contract: a name typed for a pending code continues the stored chat only when the stored session
// is on that same code. Otherwise the pending code is issued. A code that does not open is never a
// silent switch to the public tier: the visitor reads why, then goes on as a public visitor.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { enterCodeSession, openReader } from '@/fixtures/navigate';

const OWNER = {
  email: 'new-code-same-name@example.com', password: 'correct-horse-battery-staple',
  handle: 'newcodesamename', fullName: 'New Code Same Name Owner',
};

let request: APIRequestContext;
let csrf = '';
let token = '';
let sid = '';

const members = async (code: string): Promise<number | undefined> =>
  (await callTool<{ items: { code: string; member_count: number }[] }>(request, token, sid, 'codes.list', { q: code }))
    .items.find((c) => c.code === code)?.member_count;

test.describe.configure({ mode: 'serial', timeout: 180_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(300_000);
  resetInstance();
  request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  ({ csrf } = await loginAPI(request, OWNER.email, OWNER.password));
  token = await createAPIToken(request, csrf, 'new-code-same-name');
  sid = await initMCP(request, token);
});
test.afterAll(async () => { await request.dispose(); });

test('in a session on one code → a new code with the same name opens a session on the new code', async ({ page }) => {
  await createCode(request, csrf, { code: 'OLD-JANE', label: 'old' });
  await enterCodeSession(page, 'OLD-JANE', 'Jane');
  await expect(page.getByTestId('session-strip'), 'presence: in on the old code').toBeVisible();

  await createCode(request, csrf, { code: 'NEW-JANE', label: 'new' });
  await enterCodeSession(page, 'NEW-JANE', 'Jane');
  await expect(page.getByTestId('session-strip'), 'in on the new code').toBeVisible();
  expect(await members('NEW-JANE'), 'the new code has its member').toBe(1);
});

test('the old code ended → the same name on a new code still lands on the new code', async ({ page }) => {
  const old = await createCode(request, csrf, { code: 'GONE-JANE', label: 'gone' });
  await enterCodeSession(page, 'GONE-JANE', 'Jane');
  await callTool(request, token, sid, 'codes.set_expiry',
    { code_id: old.id, expires_at: new Date(Date.now() - 60_000).toISOString() });
  await createCode(request, csrf, { code: 'NEXT-JANE', label: 'next' });

  await enterCodeSession(page, 'NEXT-JANE', 'Jane');
  await expect(page.getByTestId('session-strip'), 'in on the new code').toBeVisible();
  expect(await members('NEXT-JANE'), 'the new code has its member').toBe(1);
});

test('an expired code\'s link says it expired before the visitor goes on as a public one', async ({ page }) => {
  await createCode(request, csrf, {
    code: 'LATE-JANE', label: 'late', expires_at: new Date(Date.now() - 60_000).toISOString(),
  });
  await openReader(page, '/?code=LATE-JANE');
  await expect(page.getByTestId('visitor-code-closed-why'), 'told why').toContainText(/expired/i, { timeout: 15_000 });
  await expect(page.getByTestId('visitor-name-input')).toHaveCount(0);
  await page.getByTestId('visitor-code-closed-continue').click();
  await expect(page.getByTestId('default-home'), 'a public visitor now').toBeVisible({ timeout: 15_000 });
});
