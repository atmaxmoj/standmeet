// page-edit.spec.ts —— admin 改公开页内容，访客即刻看到 / 体验。
//
// 用户故事：
//   owner 已经 claim 完，登录 admin，从默认 hero prose 改成一句自己的话，
//   保存。打开自己的公开页（/<handle>），看到那句话就是访客现在看到的。

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { expectAdminSidebarVisible, goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const NEW_HERO_PROSE =
  "I'm Alice. Newly edited hero prose to prove the page editor round-trip.";

test.describe.serial('owner edits public page, visitor sees the change', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('admin signs in, edits hero prose, save propagates to public page',
    async ({ page }) => {
      await signInToAdmin(page);
      await navigateToPageEditor(page);
      await editHeroProse(page, NEW_HERO_PROSE);
      await expectPublicPageShows(page, NEW_HERO_PROSE);
    });
});

async function signInToAdmin(page: Page): Promise<void> {
  await goto(page, '/login');
  await page.getByTestId('email').fill(OWNER.email);
  await page.getByTestId('password').fill(OWNER.password);
  await page.getByTestId('submit').click();
  await page.waitForURL('**/admin/page', { timeout: 10_000 });
}

async function navigateToPageEditor(page: Page): Promise<void> {
  // Already at /admin/page after login redirect.
  await expectAdminSidebarVisible(page);
  await expect(page.getByRole('link', { name: /\bapi · mcp\b/ })).toBeVisible();
}

async function editHeroProse(page: Page, prose: string): Promise<void> {
  const textarea = page.getByTestId('hero-prose');
  await expect(textarea).toBeVisible({ timeout: 5_000 });
  await textarea.fill(prose);
  await page.getByTestId('save').click();
  await expect(page.getByTestId('saved')).toBeVisible({ timeout: 5_000 });
}

async function expectPublicPageShows(page: Page, prose: string): Promise<void> {
  await goto(page, `/${OWNER.handle}`);
  await expect(page.getByText(prose, { exact: false })).toBeVisible({ timeout: 5_000 });
}
