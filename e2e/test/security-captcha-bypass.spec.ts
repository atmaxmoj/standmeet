// security-captcha-bypass.spec.ts —— pentest。#169 code-guard 的 captcha-escape 不能被无 op 掉:
// captcha 关闭时(noop verifier,e2e/默认部署)锁定是**硬锁**,captchaFails() 恒 true —— 攻击者
// 塞任意 captcha_token 也解不开(否则 noop.Verify(anything)=nil 就成了万能钥匙)。契约:锁定的 IP
// 带上伪造 captcha_token 仍 429,连合法码也进不来,直到窗口过期。绿=captcha 门不可绕;红=塞 token 即逃逸。

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
