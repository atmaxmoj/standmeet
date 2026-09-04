// security-code-bruteforce.spec.ts —— pentest / net-new. Access codes are guessable LABEL-XXX, and the
// redemption path (POST /api/v1/sessions + /codes/intro) has no failure lockout/captcha; the only
// throttle is a fail-open 120/min/IP —— so it can be brute-forced at full speed to grab someone else's
// RoleSnapshot (corpus + booking quota).
//
// Contract (holds after the fix): repeated **wrong** codes from the same source IP, over threshold →
// lockout (429) / require captcha, not unlimited code_invalid. Lockout is per-IP, so a legitimate visitor
// (real code, clean IP) is unaffected (no self-DoS).
// RED (before implementation): no lockout, 20 wrong codes all plain 4xx, no 429.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { OWNER, seedOwnerLoggedIn, teardownSeed, type BaseSeed } from '@/fixtures/gcal-setup';
import { createCode } from '@/fixtures/codes';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// postSessionAttempt —— hits /sessions directly; X-Forwarded-For simulates the source IP (chi.RealIP
// resolves it into RemoteAddr, clientIP reads it). Returns HTTP status.
async function postSessionAttempt(
  request: APIRequestContext, ip: string, code: string,
): Promise<number> {
  const res = await request.post(`${BACKEND}/api/v1/sessions`, {
    headers: { 'X-Forwarded-For': ip },
    data: { handle: OWNER.handle, mode: 'code', code, visitor_name: 'v' },
  });
  return res.status();
}

test.describe('pentest · access-code brute-force lockout', () => {
  let seed: BaseSeed;
  let validCode = '';

  test.beforeAll(async ({ playwright }) => {
    seed = await seedOwnerLoggedIn(playwright);
    const c = await createCode(seed.request, seed.csrf, { code: 'RECRUIT-BF1', label: 'bf' });
    validCode = c.code;
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('N wrong codes from one IP → lockout (429), not unlimited code_invalid',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const statuses: number[] = [];
      for (let i = 0; i < 20; i++) {
        statuses.push(await postSessionAttempt(request, '198.51.100.7', `NOPE-${i}`));
      }
      expect(statuses.filter((s) => s === 429).length,
        'brute force must trip a lockout (429) — currently unlimited wrong guesses')
        .toBeGreaterThan(0);
      await request.dispose();
    });

  test('lockout is per-IP: a clean IP redeeming the VALID code is unaffected',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      // First drive the attacker IP to lockout.
      for (let i = 0; i < 20; i++) {
        await postSessionAttempt(request, '198.51.100.8', `NOPE-${i}`);
      }
      // A different clean IP redeeming with the real code → still succeeds (200), not locked by association.
      const ok = await postSessionAttempt(request, '203.0.113.9', validCode);
      expect(ok, 'valid code from a clean IP still issues a session').toBe(200);
      await request.dispose();
    });
});
