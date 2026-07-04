// security-login-guard.spec.ts —— pentest。login_guard(internal/middleware)对 owner 登录做
// per-IP 30/5min 限流 + fail-closed + captcha + equal-time,但一直没有测试兜底。这里硬化:
// 同一 IP 狂试错密码,超阈值必须 429/503(不是无限全速试)。绿=防御在;红=登录可被暴力。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { OWNER, seedOwnerLoggedIn, teardownSeed, type BaseSeed } from '@/fixtures/gcal-setup';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

async function tryLogin(request: APIRequestContext, ip: string, password: string): Promise<number> {
  const res = await request.post(`${BACKEND}/api/admin/login`, {
    headers: { 'X-Forwarded-For': ip },
    data: { email: OWNER.email, password },
  });
  return res.status();
}

test.describe('pentest · login brute-force lockout', () => {
  let seed: BaseSeed;
  test.beforeAll(async ({ playwright }) => { seed = await seedOwnerLoggedIn(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('hammering wrong passwords from one IP trips the rate-limit (429/503)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const statuses: number[] = [];
      for (let i = 0; i < 40; i++) {
        statuses.push(await tryLogin(request, '198.51.100.44', `wrong-${i}`));
      }
      // login_guard: per-IP 30/5min，超限 429（redis 挂则 fail-closed 503）。必须出现，否则可暴力。
      const throttled = statuses.filter((s) => s === 429 || s === 503).length;
      expect(throttled, 'login brute force must be throttled (429/503)').toBeGreaterThan(0);
      await request.dispose();
    });
});
