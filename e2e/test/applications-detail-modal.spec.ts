// applications-detail-modal.spec.ts —— /admin/applications：empty state
// when no commits yet。
//
// 现在 backend GET /api/admin/applications/ 已通；list endpoint 返实际数据。
// 测 detail modal 行为需要先 seed 一条 application —— 走 MCP applications.commit
// 链（先 register job source → fetch → resume.draft → commit），大段 setup
// 留后续。这一版只验 empty state；modal 的 status segmented / notes 行为
// 在 seeder fixture 加好后补回。

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
test.describe('admin /applications · empty state when no commits yet', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('owner opens /applications → "No applications sent yet."',
    async ({ adminPage }) => {
      await openApplications(adminPage);
      await expect(adminPage.getByText(/No applications sent yet/i))
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

async function openApplications(page: Page): Promise<void> {
  await gotoAdminSection(page, 'applications');
  await page.waitForURL('**/admin/applications');
}
