// security-login-guard.spec.ts —— pentest. login_guard (internal/middleware) enforces
// per-IP 30/5min rate limiting + fail-closed + captcha + equal-time on owner login, but it
// never had a test backing it up. This hardens it: hammering wrong passwords from the same
// IP must trip 429/503 past the threshold (not go on unlimited at full speed). Green = the
// defense is in place; red = login can be brute-forced.

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
      // login_guard: per-IP 30/5min; over the limit is 429 (fail-closed 503 if redis is down).
      // This must appear, otherwise the login is brute-forceable.
      const throttled = statuses.filter((s) => s === 429 || s === 503).length;
      expect(throttled, 'login brute force must be throttled (429/503)').toBeGreaterThan(0);
      await request.dispose();
    });
});
