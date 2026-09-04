// revoke-purges-session.spec.ts —— when a code is revoked, the backend **purges all of that code's
// visitor sessions in Redis** (the token really dies). The cookie is not cleared by revoke directly, but
// by the **next request finding the session gone** (resolveVisitor's Sessions.Get miss → 401 → clears
// the cookie).
//
// Difference from iam-revoke-blocks-next-turn: that one tests the per-turn code-revoked check blocking
// (the token is still alive); this one tests revoke **purging the session** → hitting the generic
// invalidation path → clearing the cookie too.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, APIResponse } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const COOKIE = 'sm_vsession';

const OWNER = {
  email: 'revpurge@example.com', password: 'correct-horse-battery-staple',
  handle: 'revpurge', fullName: 'Revoke Purge Owner',
};
const CODE = 'REVPURGE-1';

test.describe('revoke purges the code\'s visitor sessions; cookie cleared on next request', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await createCode(request, csrf, { code: CODE, label: 'revpurge' });
    await request.dispose();
  });

  test('revoke → cookie-authed turn 401 + clears the cookie', async ({ playwright }) => {
    const visitor = await playwright.request.newContext();
    expect((await issueSessionRaw(visitor)).status()).toBe(200);
    expect((await turnNoBearer(visitor)).status()).toBe(200); // session alive

    // owner revokes this code → backend purges its visitor sessions.
    const admin = await playwright.request.newContext();
    const { csrf } = await loginAPI(admin, OWNER.email, OWNER.password);
    await revokeCodeByName(admin, csrf, CODE);
    await admin.dispose();

    // Hit again with the same cookie: session already purged → found invalid → 401 + clears the cookie.
    const res = await turnNoBearer(visitor);
    expect(res.status()).toBe(401);
    const cleared = setCookieHeader(res);
    expect(cleared).toContain(`${COOKIE}=`);
    expect(cleared).toMatch(/Max-Age=0/i);
    await visitor.dispose();
  });
});

function issueSessionRaw(request: APIRequestContext): Promise<APIResponse> {
  return request.post(`${BACKEND}/api/v1/sessions`, {
    data: { mode: 'code', code: CODE, visitor_name: 'Sam' },
  });
}

function turnNoBearer(request: APIRequestContext): Promise<APIResponse> {
  return request.post(`${BACKEND}/api/v1/agent/turn`, {
    headers: { 'Content-Type': 'application/json' },
    data: { system: 'You are the owner.', user_message: 'hi' },
  });
}

function setCookieHeader(res: APIResponse): string {
  return res.headersArray()
    .filter((h) => h.name.toLowerCase() === 'set-cookie')
    .map((h) => h.value)
    .join('\n');
}

async function revokeCodeByName(
  request: APIRequestContext, csrf: string, codeStr: string,
): Promise<void> {
  const listRes = await request.get(`${BACKEND}/api/admin/codes/`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (!listRes.ok()) throw new Error(`list codes: ${listRes.status()}`);
  const codes = await listRes.json() as Array<{ id: string; code: string }>;
  const target = codes.find((c) => c.code === codeStr);
  if (!target) throw new Error(`code ${codeStr} not found`);
  const res = await request.post(`${BACKEND}/api/admin/codes/${target.id}/revoke`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (!res.ok()) throw new Error(`revoke: ${res.status()}`);
}
