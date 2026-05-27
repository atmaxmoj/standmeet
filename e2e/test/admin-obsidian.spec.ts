// admin-obsidian.spec.ts —— admin obsidian section: vault stats, import/export buttons.
//
// 用户故事：
//   1. vault stats 4-cell (mode / notes / size / last sync) renders
//   2. "import vault zip" button visible
//   3. "export corpus zip" button visible

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'obsidian@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'obsidian',
  fullName: 'Obsidian Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin obsidian section', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('vault stats cells render',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'obsidian');
      await adminPage.waitForURL('**/admin/obsidian', { timeout: 5_000 });
      await expect(adminPage.getByTestId('obsidian-stats')).toBeVisible();
    });

  test('import + export buttons visible',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'obsidian');
      await expect(
        adminPage.getByRole('button', { name: /import/i }),
      ).toBeVisible();
      await expect(
        adminPage.getByRole('button', { name: /export/i }),
      ).toBeVisible();
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
