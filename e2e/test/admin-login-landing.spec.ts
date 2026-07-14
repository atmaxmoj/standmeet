// admin-login-landing.spec.ts —— three small UX guards found during the real-env audit:
//
//   UX-2: a returning owner signing in lands on /admin/dashboard (the overview),
//         NOT /admin/page (the public-face editor).
//   UX-3: the "what you get" marketing panel shows on /setup (claiming a fresh
//         instance) but NOT on /login (a returning owner who already deployed).
//   UX-1: a real favicon is served (/icon.svg 200), not a 404 → no blank tab icon.
//
// RED before the fix: /admin redirected to /admin/page; /login rendered the offers
// panel; /icon.svg 404'd.

import { test, expect } from '@/fixtures/test';

import { claim, navigateToOwnerLogin, navigateToSetup } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const OWNER = {
  email: 'landing@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'landing',
  fullName: 'Landing Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('login landing + auth-shell UX', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  // UX-2 — sign-in lands on the dashboard overview, not the public-face editor.
  test('signed-in owner lands on /admin/dashboard', async ({ adminPage: page }) => {
    await expect(page).toHaveURL(/\/admin\/dashboard$/);
    await expect(page.getByTestId('dashboard')).toBeVisible();
  });

  // UX-3 — the marketing panel is context-appropriate: absent on /login…
  test('/login hides the "what you get" offers panel', async ({ page }) => {
    await navigateToOwnerLogin(page);
    await expect(page.getByTestId('email')).toBeVisible();
    await expect(page.getByTestId('auth-offers')).toHaveCount(0);
  });

  // …and present on /setup (claiming a fresh instance).
  test('/setup shows the "what you get" offers panel', async ({ page }) => {
    await navigateToSetup(page);
    await expect(page.getByTestId('auth-offers')).toBeVisible();
  });

  // UX-1 — a real favicon is served, not a 404.
  test('a favicon is served (no blank tab icon)', async ({ page }) => {
    const resp = await page.request.get('/icon.svg');
    expect(resp.status()).toBe(200);
    expect(resp.headers()['content-type'] ?? '').toContain('svg');
  });
});
