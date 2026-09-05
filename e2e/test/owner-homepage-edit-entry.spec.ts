// owner-homepage-edit-entry.spec.ts —— the microsites section has a dedicated, always-present
// entry to edit the homepage (served at /), so the owner never has to hunt for the `home` row
// in the list ("要在 microsites 里面有个自己的单独的编辑入口"). It opens the same mini-IDE at
// /admin/edit/home.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'homeentry@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'homeentry',
  fullName: 'Home Entry Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('owner homepage edit entry', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('the microsites section links straight to the homepage editor', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'microsites');
    const entry = adminPage.getByTestId('microsite-edit-homepage');
    await expect(entry).toBeVisible();
    await entry.click();
    await expect(adminPage).toHaveURL(/\/admin\/edit\/home$/, { timeout: 10_000 });
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
