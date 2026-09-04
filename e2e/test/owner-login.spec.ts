// owner-login.spec.ts —— the sign-in flow for an owner who has already claimed the instance.
//
// User story:
//   The owner already claimed the instance earlier, closed the browser, and is
//   coming back a second time. They type /admin in the address bar → server
//   sees no session, redirects to /login → fill in email + password → submit →
//   land on /admin/page. A wrong password shows an inline error without
//   leaving /login.
//
// Claim goes through an API helper (not the path under test); login runs
// entirely through the browser. Both cases share "navigateToOwnerLogin"
// (fixture-level goto /admin → auto-redirect to /login).

import { test, expect } from '@/fixtures/test';

import { claim, navigateToOwnerLogin } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('owner logs back in', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('right credentials land owner in admin', async ({ adminPage: page }) => {
    // The adminPage fixture already runs owner-typed /admin → /login → fill form → /admin/page on its own.
    // Here we only assert that it landed in the right place (the admin sidebar rendered).
    await expect(page.getByTestId('admin-nav-account')).toBeVisible();
  });

  test('wrong password shows inline error, stays on /login', async ({ page }) => {
    await navigateToOwnerLogin(page);
    await page.getByTestId('email').fill(OWNER.email);
    await page.getByTestId('password').fill('not-the-password');
    await page.getByTestId('submit').click();
    await expect(page.getByTestId('error')).toBeVisible({ timeout: 5_000 });
    await expect(page).toHaveURL(/.*\/login$/);
  });
});
