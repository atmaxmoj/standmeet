// captcha-on-login-lift.spec.ts — F-G-8: of the three doors, the owner's own door has
// no key.
//
// Once the gate's two doors (code / message) are blocked per-IP, one valid
// human-check clears them (F-G-3 / F-G-4).
// **The login door has no such lift**: `serveLoginGuard` checks the rate limit before
// the check, and the over-limit branch never looks at the token at all — so an owner
// whose password is completely correct and whose check is solved is still locked out
// of their own instance until the window passes on its own.
//
// With captcha on, that check **must be passed on every single login attempt** — an
// attacker already pays a cost per try, so the rate limit here can't stop them, it can
// only stop the one person who's actually supposed to get in. This doesn't apply with
// captcha off: there's no check to solve then, so the hard lock is the only defense
// (that's the half `security-login-guard` covers).
//
// Run via `make test-captcha` (Cloudflare's always-pass test key).

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { skipUnlessCaptchaOn } from '@/fixtures/captcha';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'login-lift@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'loginlift',
  fullName: 'Login Lift Owner',
};

// ATTEMPTS — crosses `loginRateLimitMax` (30 / 5min).
const ATTEMPTS = 34;

test.describe('login · a rate-limited owner can still clear the check and get in', () => {
  test.beforeAll(async ({ playwright }) => {
    // Skip the whole group if this instance doesn't have captcha on (instead of
    // leaving a permanently red test) — see fixtures/captcha.ts.
    await skipUnlessCaptchaOn(await playwright.request.newContext());
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('past the attempt ceiling a solved check still lets the right password through',
    async ({ page }) => {
      await goto(page, '/login');
      // First prove this instance actually has captcha configured — otherwise "solved
      // the check yet still can't get in" is testing a machine with no check at all,
      // going red for a reason nobody can point to ([[red-in-the-wrong-place]]).
      await expect(
        page.getByTestId('turnstile-host'),
        'captcha must be configured for this spec — run it via `make test-captcha`',
      ).toBeVisible({ timeout: 15_000 });

      // Only requests fired from **the browser itself** land in the same bucket: the
      // backend sees this page's origin as the source. Hammering from a separate
      // APIRequestContext hits a different bucket, and the gate would never fall on
      // the page in front of me.
      const seen = await hammer(page, ATTEMPTS);
      // First confirm the attempt count is really hit: every entry is a **real**
      // response that came back, so 34 entries means 34 real attempts, already past
      // the 30/5min line.
      expect(
        seen.length, 'the attempt ceiling must actually be crossed',
      ).toBeGreaterThan(30);
      // And no 429 should ever appear along the way: every submission carries a
      // solved token, so the gate must never fall on this person. What should always
      // come back is "wrong password" — that's the **true** answer, and it's his own
      // doing.
      expect(
        seen, 'a person who clears the check on every try is not the one this ceiling is for',
      ).not.toContain(429);

      // Now: the correct password + the check that just issued its own token →
      // the owner must be able to get in.
      await page.reload();
      await page.getByTestId('email').fill(OWNER.email);
      await page.getByTestId('password').fill(OWNER.password);
      await expect(
        page.getByTestId('submit'),
        'the form waits for the check to issue its token before it will submit',
      ).toBeEnabled({ timeout: 30_000 });
      await page.getByTestId('password').press('Enter');
      await expect(
        page,
        'a solved check is the way through this lock too — otherwise the owner is shut out of '
          + 'their own instance by a defence aimed at someone else',
      ).toHaveURL(/\/admin/, { timeout: 20_000 });
    });
});

// hammer — repeatedly submit the wrong password on this same form, returning the
// status code from each attempt.
//
// Goes through the form rather than a separate request context: the gate buckets by
// origin, and a different context hits **a different bucket**, so the gate that
// falls wouldn't be the one on the page in front of me. This is also exactly the
// shape of the thing being defended against — someone hammering the login form
// over and over.
async function hammer(page: Page, times: number): Promise<number[]> {
  const seen: number[] = [];
  await page.getByTestId('email').fill(OWNER.email);
  // Wait for the token before hammering. The widget's host div is visible the moment
  // it mounts, but the token itself takes a second or two, and until then the submit
  // key is disabled — pressing Enter does nothing, and a timeout there would look like
  // "the product refuses logins" when actually I just moved too soon.
  await page.getByTestId('password').fill('wrong-warmup');
  await expect(page.getByTestId('submit')).toBeEnabled({ timeout: 30_000 });
  for (let i = 0; i < times; i++) {
    const answered = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/api/admin/login'),
      { timeout: 20_000 },
    );
    await page.getByTestId('password').fill(`wrong-${i}`);
    await page.getByTestId('password').press('Enter');
    seen.push((await answered).status());
  }
  return seen;
}
