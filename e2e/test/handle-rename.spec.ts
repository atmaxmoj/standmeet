// handle-rename.spec.ts —— owner 在 admin 改 URL handle，老 URL 仍可访问。
//
// 用户故事：
//   owner claim 时用了 `alice`，分享了一堆 https://standmeet.com/alice/?code=XXX
//   的链接出去。后来想用 `alice2`，进 admin 改了一下。新链接 /alice2 立刻可用，
//   老的 /alice 也不能 404 —— 因为 handle_aliases 自动留了一条旧值。

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  initialHandle: 'alice',
  newHandle: 'alice2',
  fullName: 'Alice Anderson',
};

test.describe.serial('owner renames URL handle, old links still resolve', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.initialHandle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('admin renames handle and both URLs still resolve', async ({ page }) => {
    await signInToAdmin(page);
    await renameHandle(page, OWNER.newHandle);
    await expectPublicPageLoads(page, OWNER.newHandle);
    await expectPublicPageLoads(page, OWNER.initialHandle); // alias fallback
  });
});

async function signInToAdmin(page: Page): Promise<void> {
  await goto(page, '/login');
  await page.getByTestId('email').fill(OWNER.email);
  await page.getByTestId('password').fill(OWNER.password);
  await page.getByTestId('submit').click();
  await page.waitForURL('**/admin/page', { timeout: 10_000 });
}

async function renameHandle(page: Page, next: string): Promise<void> {
  const display = page.getByTestId('handle-display');
  await expect(display).toBeVisible({ timeout: 5_000 });
  await expect(display).toContainText(OWNER.initialHandle);

  await page.getByTestId('handle-change-btn').click();
  const input = page.getByTestId('handle-input');
  await expect(input).toBeVisible();
  await input.fill(next);

  await expect(page.getByTestId('handle-hint')).toContainText('alias');
  await page.getByTestId('handle-save-btn').click();

  await expect(page.getByTestId('handle-display')).toContainText(next, { timeout: 5_000 });
}

async function expectPublicPageLoads(page: Page, handle: string): Promise<void> {
  await goto(page, `/${handle}`);
  await expect(page.getByText(OWNER.fullName, { exact: false })).toBeVisible({ timeout: 5_000 });
}
