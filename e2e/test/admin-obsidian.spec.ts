// admin-obsidian.spec.ts —— /admin/obsidian renders the REAL, functional import/export (F-L-1).
//
// The page used to be a dead mockup: a fake vault path + hardcoded stat cells (mode/notes/size/
// last-sync) + two `<button>`s with no onClick. The old spec asserted those fake cells rendered —
// false confidence. It now renders the shared ObsidianBar (the same working folder-picker +
// export the writings section uses). These guards assert the actions are real, not dead.

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

  test('renders the real ObsidianBar (folder picker), not the dead mockup (F-L-1)',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'obsidian');
      await adminPage.waitForURL('**/admin/obsidian', { timeout: 5_000 });
      // The real, functional component + its vault-folder <input> — the mockup had neither.
      await expect(adminPage.getByTestId('obsidian-bar')).toBeVisible();
      await expect(adminPage.getByTestId('obsidian-vault-input')).toBeAttached();
      // The old fake stat cell is gone (it implied a live-synced vault that never existed).
      await expect(adminPage.getByTestId('vault-stat-mode')).toHaveCount(0);
    });

  test('the export button actually downloads the corpus vault (F-L-1)',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'obsidian');
      await expect(adminPage.getByTestId('obsidian-bar')).toBeVisible();
      // A dead button fires no download; the real one hits GET /obsidian/export → a .zip.
      const download = adminPage.waitForEvent('download', { timeout: 10_000 });
      await adminPage.getByRole('button', { name: /export/i }).click();
      expect((await download).suggestedFilename()).toMatch(/\.zip$/);
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
