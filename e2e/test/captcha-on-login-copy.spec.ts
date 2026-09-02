// captcha-login-copy.spec.ts —— F-G-5: a failed human check must not be reported as "wrong password".
//
// `login_guard.go`'s order is rate-limit → captcha → credentials, and the captcha
// step **short-circuits before the credential check**, yet it returns the
// `invalid credentials` envelope. So an owner with a **completely correct**
// password, whenever that check simply fails to load (network blocked,
// Cloudflare hiccup, a blocking extension), also gets "wrong password" — they go
// change their password, while the real cause lives somewhere else.
//
// "vagueness for anti-enumeration" doesn't apply here: wrong-password vs.
// no-such-user needs to stay vague, to avoid leaking whether an account exists.
// "failed human check" is not an account oracle — saying it leaks nothing. The
// rate-limit branch in this same file already tells the truth
// ("too many login attempts, try again later") — the contrast sits right there.
//
// Only drivable while captcha is actually on — run via `make test-captcha`
// (Cloudflare test keys).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { skipUnlessCaptchaOn } from '@/fixtures/captcha';
import { findSetupToken, resetInstance } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'captcha-copy@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'captchacopy',
  fullName: 'Captcha Copy Owner',
};

test.describe('login · a failed human check must not be reported as a wrong password', () => {
  let request: APIRequestContext;

  test.beforeAll(async ({ playwright }) => {
    // If this instance doesn't have captcha on, skip the whole group (rather than
    // leaving a permanently-red case) — see fixtures/captcha.ts.
    await skipUnlessCaptchaOn(await playwright.request.newContext());
    resetInstance();
    request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
  });
  // `?.` isn't defensive style here, it's **the actual shape of the skip path**:
  // when the whole group is skipped, `beforeAll` is aborted before the
  // assignment runs, so `request` never existed — yet afterAll still runs.
  // Without this question mark, "skipped" would show up as a 0ms red, which
  // looks exactly like the kind of red this test exists to eliminate.
  test.afterAll(async () => { await request?.dispose(); });

  test('the RIGHT password with no captcha token is not called "invalid credentials"',
    async () => {
      // The password is correct — that's the entire point of this case: the
      // rejection reason is that check, not the credentials.
      const res = await request.post(`${BACKEND}/api/admin/login`, {
        data: { email: OWNER.email, password: OWNER.password },
      });
      expect(res.status(), 'a missing human check still refuses the login').toBe(401);

      const body = await res.text();
      expect(
        body.toLowerCase(),
        'the owner typed the right password — telling them it is invalid sends them to reset it, '
          + 'and the real cause (the human check) is never named',
      ).not.toContain('invalid credentials');
      expect(
        body.toLowerCase(),
        'the refusal has to name the human check, the way the rate-limit branch names the limit',
      ).toMatch(/human check|captcha|verification/);
    });
});
