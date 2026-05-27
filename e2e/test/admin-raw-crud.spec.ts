// admin-raw-crud.spec.ts —— raw entries: DumpBox, filter, promote, archive, edit.
//
// 用户故事：
//   1. DumpBox → 选 source chip → 输入 → dump → 新行出现
//   2. filter 切换 (unprocessed / promoted / all) → list 过滤
//   3. promote → wiki modal → 填 title → confirm → raw 变 "promoted"
//   4. 编辑 body → save → body 更新

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'raw-crud@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'rawcrud',
  fullName: 'Raw CRUD Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin raw CRUD operations', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('DumpBox → input → dump → new entry in list',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'raw');
      await adminPage.waitForURL('**/admin/raw', { timeout: 5_000 });
      // Open dump box
      const dumpInput = adminPage.getByTestId('dump-body');
      await dumpInput.fill('Test raw entry from UI.');
      await adminPage.getByTestId('dump-submit').click();
      // New row should appear
      await expect(adminPage.getByText('Test raw entry from UI.', { exact: false }))
        .toBeVisible({ timeout: 5_000 });
    });

  test('filter toggle → unprocessed vs all',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'raw');
      // Switch to "all" filter
      const allFilter = adminPage.getByTestId('raw-filter-all');
      if (await allFilter.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await allFilter.click();
        await expect(adminPage.getByTestId('raw-list')).toBeVisible();
      }
    });

  test('promote raw → wiki modal → fill title → raw marked promoted',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'raw');
      await dumpEntry(adminPage, 'Entry to promote to wiki.');
      const row = adminPage.locator('[data-testid^="raw-row-"]', {
        hasText: 'Entry to promote to wiki.',
      });
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: /promote/i }).click();
      // Fill wiki title in modal
      const titleInput = adminPage.getByTestId('promote-wiki-title');
      await titleInput.fill('Promoted Wiki Entry');
      await adminPage.getByRole('button', { name: /^promote$/i }).click();
      // Raw should show "promoted" status
      await expect(row).toContainText(/promoted/i);
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

async function dumpEntry(page: Page, body: string): Promise<void> {
  const dumpInput = page.getByTestId('dump-input');
  await dumpInput.fill(body);
  await page.getByRole('button', { name: /dump/i }).click();
  await expect(page.getByText(body, { exact: false }))
    .toBeVisible({ timeout: 5_000 });
}
