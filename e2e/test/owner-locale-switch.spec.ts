// owner-locale-switch.spec.ts —— the owner can switch the admin UI language from a
// permanent spot in the admin top bar (not buried in Account settings). Proves the
// switcher is reachable from the chrome AND actually changes the interface language,
// not just the URL (the sign-out lesson: a control that renders isn't a control that works).

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'ownerlocale@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'ownerlocale',
  fullName: 'Owner Locale',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('owner switches admin UI language from the top bar', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('the chrome switcher moves the admin UI to Chinese on click, no reload', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'system');
    // baseline: the sign-out control is in English
    await expect(adminPage.getByTestId('signout')).toHaveText(/sign out/i);

    const sw = adminPage.getByTestId('locale-switch').first();
    await expect(sw).toBeVisible();
    await sw.locator('summary').click();
    await sw.getByTestId('locale-opt-zh').click();

    // The CLICK ITSELF must switch the visible chrome — a real user does not reload. This is the
    // regression that shipped: with a next/link soft nav the URL changed to /zh and the cookie was
    // set, but the sign-out label stayed "SIGN OUT" until a manual reload ("clicked, nothing
    // happened"). Assert Chinese with NO reload, so a soft-nav regression fails here.
    await expect(adminPage.getByTestId('signout')).toHaveText('退出登录', { timeout: 10_000 });
    await expect.poll(() => new URL(adminPage.url()).pathname).toMatch(/^\/zh(\/|$)/);
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
