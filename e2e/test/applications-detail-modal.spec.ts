// applications-detail-modal.spec.ts — /admin/applications: empty state
// when no commits yet.
//
// The backend GET /api/admin/applications/ now works; the list endpoint returns real
// data. Testing detail-modal behavior first needs an application seeded — via the MCP
// applications.commit chain (register job source → fetch → resume.draft → commit),
// which is a large chunk of setup left for later. This version only verifies the empty
// state; the modal's status-segmented / notes behavior gets added back once the
// seeder fixture exists.

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
