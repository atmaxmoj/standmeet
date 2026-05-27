// drafts-composer.spec.ts —— /admin/drafts：empty state when no drafts pending。
//
// backend GET /api/admin/drafts/ 现在返实际数据；测 ResumeComposer 行为
// 需要先 seed 一条 draft（MCP resume.draft 链）。这一版只验 empty state；
// composer 6-panel / send confirm 行为在 seeder fixture 加好后补回。

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin /drafts · empty state when no drafts pending', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('owner opens /drafts → "No drafts pending."',
    async ({ adminPage }) => {
      await openDrafts(adminPage);
      await expect(adminPage.getByText(/No drafts pending/i))
        .toBeVisible({ timeout: 5_000 });
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await loginAPI(request, OWNER.email, OWNER.password);
  await request.dispose();
}

async function openDrafts(page: Page): Promise<void> {
  await gotoAdminSection(page, 'drafts');
  await page.waitForURL('**/admin/drafts');
}
