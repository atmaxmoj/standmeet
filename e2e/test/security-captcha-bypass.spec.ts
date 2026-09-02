// security-captcha-bypass.spec.ts -- pentest. #169's code-guard captcha-escape
// must not become a no-op: when captcha is off (the noop verifier, e2e/default
// deployment), the lockout must be a **hard lock** -- captchaFails() stays
// true unconditionally, so an attacker stuffing in any captcha_token can't
// unlock it (otherwise noop.Verify(anything)=nil would become a master key).
// Contract: a locked-out IP presenting a forged captcha_token still gets 429,
// and not even the legitimate code gets through, until the window expires.
// Green = the captcha gate cannot be bypassed; red = stuffing a token escapes it.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { OWNER, seedOwnerLoggedIn, teardownSeed, type BaseSeed } from '@/fixtures/gcal-setup';
import { createCode } from '@/fixtures/codes';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

async function postSession(
  request: APIRequestContext, ip: string, code: string, captchaToken?: string,
): Promise<number> {
  const res = await request.post(`${BACKEND}/api/v1/sessions`, {
    headers: { 'X-Forwarded-For': ip },
    data: { handle: OWNER.handle, mode: 'code', code, visitor_name: 'v', captcha_token: captchaToken },
  });
  return res.status();
}

test.describe('pentest · code-lock captcha-escape cannot be no-op bypassed', () => {
  let seed: BaseSeed;
  let validCode = '';
  test.beforeAll(async ({ playwright }) => {
    seed = await seedOwnerLoggedIn(playwright);
    const c = await createCode(seed.request, seed.csrf, { code: 'CAPBYP-1', label: 'cap' });
    validCode = c.code;
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('a bogus captcha_token does not unlock a locked IP (captcha off → hard lock)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const ip = '198.51.100.61';
      // Lock the IP with wrong codes.
      const locking: number[] = [];
      for (let i = 0; i < 20; i++) locking.push(await postSession(request, ip, `NOPE-${i}`));
      expect(locking.filter((s) => s === 429).length, 'IP gets locked').toBeGreaterThan(0);

      // Attacker supplies forged captcha tokens to escape — must NOT work while captcha is off.
      for (const token of ['x', 'valid-looking-token', '1x0000FFtoken', '']) {
        expect(await postSession(request, ip, `NOPE-bypass`, token),
          `forged captcha_token '${token}' must not unlock`).toBe(429);
      }
      // Even the VALID code from the locked IP stays blocked (escape is not available).
      expect(await postSession(request, ip, validCode, 'valid-looking-token'),
        'locked IP cannot redeem even a valid code via forged captcha').toBe(429);
      await request.dispose();
    });
});
