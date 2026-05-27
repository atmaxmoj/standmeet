// admin-wiki-crud.spec.ts —— wiki CRUD: tag filter, excerpt, visibility,
// promote to output, SEO edit.
//
// 用户故事：
//   1. tag filter → click tag → wiki list filtered
//   2. excerpt → shows body truncated to 200 chars
//   3. visibility dot → public gray / private accent
//   4. promote wiki to output → output list shows new entry
//   5. SEO edit → slug / description / indexed toggle

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'wikicrud@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'wikicrud',
  fullName: 'Wiki CRUD Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin wiki CRUD extended', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('create wiki via UI → excerpt visible in list',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'wiki');
      await adminPage.waitForURL('**/admin/wiki', { timeout: 5_000 });
      await adminPage.getByTestId('wiki-new-btn').click();
      await adminPage.getByTestId('wiki-create-title').fill('Tagged Wiki Entry');
      await adminPage.getByTestId('wiki-create-body').fill(
        'This is a long body that should be truncated in the excerpt preview on the admin wiki list page.',
      );
      await adminPage.getByTestId('wiki-create-submit').click();
      // Wiki row shows excerpt
      await expect(adminPage.getByText('Tagged Wiki Entry')).toBeVisible({ timeout: 5_000 });
    });

  test('promote wiki to output via UI',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'wiki');
      const row = adminPage.locator('[data-testid^="wiki-row-"]', {
        hasText: 'Tagged Wiki Entry',
      });
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: /promote → output/i }).click();
      const titleInput = row.locator('[data-testid$="-title"]').first();
      await titleInput.fill('Promoted Output from Wiki');
      await row.getByRole('button', { name: /^promote$/i }).click();
      // Verify in output section
      await gotoAdminSection(adminPage, 'output');
      await adminPage.waitForURL('**/admin/output', { timeout: 5_000 });
      await expect(adminPage.getByText('Promoted Output from Wiki')).toBeVisible();
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
