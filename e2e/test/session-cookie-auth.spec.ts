// session-cookie-auth.spec.ts — besides the bearer token, the session also sets an HttpOnly
// cookie (sm_vsession): recognized across tabs / survives a refresh / recognized by SSR. When it
// becomes invalid (expired/evicted), the backend writes back an expired cookie to clear it out
// ("Sam's session expired → a 401 clears the browser's credential").
//
// Uses a single APIRequestContext as the cookie jar: the Set-Cookie from POST /sessions goes into
// the jar → a later request that carries **no bearer** authenticates via the cookie instead.

import { test, expect } from '@/fixtures/test';
import { execSync } from 'node:child_process';
import type { APIRequestContext, APIResponse } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const REDIS_CONTAINER = 'standmeet-dev-redis-1';
const COOKIE = 'sm_vsession';

const OWNER = {
  email: 'cookieauth@example.com', password: 'correct-horse-battery-staple',
  handle: 'cookieauth', fullName: 'Cookie Auth Owner',
};
const CODE = 'COOKIE-1';

test.describe('session token cookie: auth fallback + clear-on-invalidation', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await createCode(request, csrf, { code: CODE, label: 'cookie' });
    await request.dispose();
  });

  test('issuing a session sets sm_vsession cookie; cookie alone authenticates a turn',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const issue = await issueSessionRaw(request);
      expect(issue.status()).toBe(200);
      expect(setCookieHeader(issue)).toContain(`${COOKIE}=`);
      // No Authorization header — authenticates solely via the sm_vsession cookie in the jar.
      const turn = await turnNoBearer(request);
      expect(turn.status()).toBe(200);
      await request.dispose();
    });

  test('evicting the session → cookie-authed turn 401 + clears the cookie',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      expect((await issueSessionRaw(request)).status()).toBe(200);
      evictVisitorSessions();
      const res = await turnNoBearer(request);
      expect(res.status()).toBe(401);
      // The backend writes back an expired cookie to clear it (Max-Age=0).
      const cleared = setCookieHeader(res);
      expect(cleared).toContain(`${COOKIE}=`);
      expect(cleared).toMatch(/Max-Age=0/i);
      await request.dispose();
    });
});

function issueSessionRaw(request: APIRequestContext): Promise<APIResponse> {
  return request.post(`${BACKEND}/api/v1/sessions`, {
    data: { mode: 'code', code: CODE, visitor_name: 'Sam' },
  });
}

function turnNoBearer(request: APIRequestContext): Promise<APIResponse> {
  return request.post(`${BACKEND}/api/v1/agent/turn`, {
    headers: { 'Content-Type': 'application/json' }, // deliberately no Authorization
    data: { system: 'You are the owner.', user_message: 'hi' },
  });
}

function setCookieHeader(res: APIResponse): string {
  return res.headersArray()
    .filter((h) => h.name.toLowerCase() === 'set-cookie')
    .map((h) => h.value)
    .join('\n');
}

function evictVisitorSessions(): void {
  const script = 'redis-cli --scan --pattern "vsession:*" | xargs -r redis-cli DEL';
  execSync(`docker exec ${REDIS_CONTAINER} sh -c '${script}'`, { stdio: 'pipe' });
}
