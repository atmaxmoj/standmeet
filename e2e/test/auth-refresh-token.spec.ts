// auth-refresh-token.spec.ts —— the owner session must not die after a day. Login now issues an
// access session AND a long-lived refresh token; when the access cookie expires the frontend
// silently refreshes (rotating BOTH tokens), so an active owner stays signed in indefinitely.
//
// Two faithful checks, neither waits out a real TTL:
//   A. API: login sets a refresh cookie; POST /refresh rotates it (new value) and the new access
//      session works; replaying the OLD refresh token fails (single-use rotation = theft defense).
//   B. UI: after login, dropping ONLY the access cookie (what a browser does when it expires) and
//      reloading admin keeps the owner signed in — the interceptor refreshes instead of bouncing
//      to /login.
//
// RED before the change: login sets no refresh cookie, POST /api/admin/refresh 404s, and dropping
// the access cookie bounces the owner to /login.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'refresh@example.com', password: 'correct-horse-battery-staple',
  handle: 'refreshowner', fullName: 'Refresh Owner',
};
const SESSION_COOKIE = 'smt_session';
const REFRESH_COOKIE = 'smt_refresh';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('auth · access + refresh dual token keeps the owner signed in', () => {
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('login issues a refresh token; refresh rotates it and the old one is single-use',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      // eslint-disable-next-line e2e-local/no-direct-mutating-api -- login IS the flow under test
      const loginResp = await request.post('/api/admin/login',
        { data: { email: OWNER.email, password: OWNER.password } });
      expect(loginResp.status(), 'login ok').toBe(200);

      const after = (await request.storageState()).cookies;
      const refresh1 = after.find((c) => c.name === REFRESH_COOKIE);
      expect(after.find((c) => c.name === SESSION_COOKIE), 'login sets an access cookie').toBeTruthy();
      expect(refresh1, 'login sets a refresh cookie').toBeTruthy();

      // eslint-disable-next-line e2e-local/no-direct-mutating-api -- refresh IS the endpoint under test
      const refreshed = await request.post('/api/admin/refresh');
      expect(refreshed.status(), 'refresh succeeds with the refresh cookie').toBe(204);
      const refresh2 = (await request.storageState()).cookies.find((c) => c.name === REFRESH_COOKIE);
      expect(refresh2?.value, 'the refresh token rotates on use').not.toBe(refresh1?.value);
      expect((await request.get('/api/admin/me')).status(), 'the new access session works').toBe(200);

      // The rotated-away token is dead: replaying it (fresh context, explicit cookie) is rejected.
      const stale = await playwright.request.newContext();
      // eslint-disable-next-line e2e-local/no-direct-mutating-api -- replaying a used refresh token IS the test
      const replay = await stale.post('/api/admin/refresh',
        { headers: { cookie: `${REFRESH_COOKIE}=${refresh1?.value ?? ''}` } });
      expect(replay.status(), 'a used refresh token cannot be replayed').toBe(401);

      await request.dispose();
      await stale.dispose();
    });

  test('an expired access cookie is transparently refreshed — the owner is not bounced to login',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'microsites');
      await page.waitForURL('**/admin/microsites', { timeout: 10_000 });

      // Simulate the access cookie expiring: drop ONLY it, keep the long-lived refresh cookie.
      await page.context().clearCookies({ name: SESSION_COOKIE });

      // Reloading admin now sends no access cookie → /me 401 → the interceptor refreshes using the
      // refresh cookie → the owner stays in, never redirected to /login.
      await page.reload();
      await expect(page.getByTestId('admin-nav-microsites'), 'still signed in after refresh')
        .toBeVisible({ timeout: 15_000 });
      expect(page.url(), 'not bounced to login').not.toContain('/login');
    });
});
