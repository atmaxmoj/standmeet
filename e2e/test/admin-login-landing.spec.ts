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

  // UX-1 — a real favicon is served (both the modern icon.svg link target AND the
  // legacy /favicon.ico the browser auto-probes) → no blank tab icon, no per-page
  // 404 console noise.
  test('a favicon is served (no blank tab icon)', async ({ page }) => {
    const svg = await page.request.get('/icon.svg');
    expect(svg.status()).toBe(200);
    expect(svg.headers()['content-type'] ?? '').toContain('svg');
    const ico = await page.request.get('/favicon.ico');
    expect(ico.status()).toBe(200);
  });

  // F-C-4 — the version/build badge is ONE source of truth: the admin top-bar shows the SAME
  // version string as the login page, and it is not a hardcoded env label. RED before the fix:
  // `/login` showed "v1.0.0" (auth.json) while the admin banner hardcoded "v0.1 · dev"
  // (`TopBar.tsx DEFAULT_BUILD`, buildTag never threaded) — two contradicting version strings
  // and a fake "dev" env label shown even on prod. A name-that-lies: the badge tracks nothing.
  test('admin build badge equals the login version and is not a hardcoded env label (F-C-4)',
    async ({ page }) => {
      // one page (no adminPage fixture — it shares a context and would deauth `page`):
      // read the version on /login, then sign in on the same page and read the admin badge.
      await navigateToOwnerLogin(page);
      const loginVersion = (await page.getByTestId('app-version').innerText()).trim();
      await page.getByTestId('email').fill(OWNER.email);
      await page.getByTestId('password').fill(OWNER.password);
      await page.getByTestId('submit').click();
      await page.waitForURL('**/admin/**', { timeout: 10_000 });
      const buildTag = (await page.getByTestId('build-tag').innerText()).trim();
      expect(buildTag, 'admin banner version must equal the login version (one source of truth)')
        .toBe(loginVersion);
      expect(buildTag, 'the badge must not be a fixed env label like "dev"')
        .not.toMatch(/\bdev\b/i);
    });
});
