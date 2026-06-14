// session-cookie-auth.spec.ts —— session token 除了 bearer,也落一份 HttpOnly cookie
// (sm_vsession):跨 tab / 活过刷新 / SSR 都认。失效(过期/evict)时,后端回写一个过期
// cookie 把它清掉(「sam 过期了 → 一个 401 把浏览器凭证清掉」)。
//
// 用同一个 APIRequestContext 当 cookie jar:POST /sessions 的 Set-Cookie 进 jar →
// 之后**不带 bearer** 的请求靠 cookie 认。

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
      // 不带 Authorization,只靠 cookie jar 里的 sm_vsession 认。
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
      // 后端回写过期 cookie 清掉它(Max-Age=0)。
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
    headers: { 'Content-Type': 'application/json' }, // 故意不带 Authorization
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
