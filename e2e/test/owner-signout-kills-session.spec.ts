// owner-signout-kills-session.spec.ts —— clicking "sign out" must actually kill the
// server-side session, not just navigate away.
//
// Regression: the sign-out button POSTed to /api/admin/sessions/signout, which was never
// implemented; the client swallowed the 404 and redirected to /login. The Redis session
// stayed alive and the cookie was never cleared — so a captured session token kept working
// after "logging out" (a real security hole the owner reported). The working endpoint,
// /api/admin/me/logout, was never called by the UI, and nothing tested the button.
//
// This drives the REAL button (not the backend endpoint directly — that already worked)
// and asserts the captured session token is dead server-side afterwards.

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const SESSION_COOKIE = 'smt_session';

const OWNER = {
  email: 'signout@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'signout',
  fullName: 'Signout Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('owner sign-out kills the server session', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('sign out asks to confirm first, then revokes the session server-side',
    async ({ adminPage, playwright }) => {
      const token = await sessionCookieValue(adminPage);
      expect(token, 'owner has a session cookie after login').toBeTruthy();
      // baseline: the captured cookie authenticates an owner-only endpoint
      expect(await meStatus(playwright, token)).toBe(200);

      // The first click opens a confirm modal — it must NOT sign out on its own (an accidental
      // click shouldn't end the session).
      await adminPage.getByTestId('signout').click();
      await expect(adminPage.getByTestId('signout-confirm'),
        'sign-out opens a confirm modal').toBeVisible();
      expect(await meStatus(playwright, token), 'opening the modal does not sign out').toBe(200);

      // Cancel dismisses it and the session stays alive.
      await adminPage.getByTestId('signout-cancel').click();
      await expect(adminPage.getByTestId('signout-confirm')).toHaveCount(0);
      expect(await meStatus(playwright, token), 'cancel does not sign out').toBe(200);

      // Confirming actually signs out — and the security assertion still holds: the SAME captured
      // token is dead server-side afterwards.
      await adminPage.getByTestId('signout').click();
      await adminPage.getByTestId('signout-confirm-btn').click();
      await adminPage.waitForURL('**/login', { timeout: 10_000 });
      expect(await meStatus(playwright, token)).toBe(401);
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}

async function sessionCookieValue(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  return cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? '';
}

// meStatus — hit an owner-only endpoint with ONLY the given session cookie, return the status.
async function meStatus(playwright: Playwright, token: string): Promise<number> {
  const ctx = await playwright.request.newContext();
  const res = await ctx.get(`${BACKEND}/api/admin/me`, {
    headers: { Cookie: `${SESSION_COOKIE}=${token}` },
  });
  const status = res.status();
  await ctx.dispose();
  return status;
}
