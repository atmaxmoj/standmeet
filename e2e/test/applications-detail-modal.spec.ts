// applications-detail-modal.spec.ts —— /admin/applications 点 card 进
// ApplicationDetailModal：timeline / contact / notes / snapshot / status
// segmented。
//
// data 仍 mock fixture（list endpoint 待补），UI 行为完整。

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

test.describe.serial('admin /applications · detail modal · status segmented', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('click card → modal opens with timeline + status segmented',
    async ({ adminPage }) => {
      await openApplications(adminPage);
      await adminPage.getByTestId('application-row-a-anth-mts').click();
      await expect(adminPage.getByTestId('application-detail-modal')).toBeVisible();
      // status segmented 5 选项
      const segmented = adminPage.getByTestId('application-status');
      await expect(segmented).toBeVisible();
      for (const s of ['silent', 'reviewing', 'replied', 'rejected', 'offer']) {
        await expect(adminPage.getByTestId(`status-${s}`)).toBeVisible();
      }
    });

  test('change status → segmented active state moves',
    async ({ adminPage }) => {
      await openApplications(adminPage);
      await adminPage.getByTestId('application-row-a-anth-mts').click();
      // Anthropic 默认 reviewing
      await expect(adminPage.getByTestId('status-reviewing')).toHaveClass(/is-on/);
      // 改成 offer
      await adminPage.getByTestId('status-offer').click();
      await expect(adminPage.getByTestId('status-offer')).toHaveClass(/is-on/);
      await expect(adminPage.getByTestId('status-reviewing')).not.toHaveClass(/is-on/);
    });

  test('notes textarea editable + close',
    async ({ adminPage }) => {
      await openApplications(adminPage);
      await adminPage.getByTestId('application-row-a-anth-mts').click();
      const notes = adminPage.getByTestId('application-detail-notes');
      await notes.fill('owner private note: follow up next Tuesday');
      await expect(notes).toHaveValue(/follow up next Tuesday/);
      // close 关闭模态
      await adminPage.getByTestId('application-detail-close').click();
      await expect(adminPage.getByTestId('application-detail-modal')).toBeHidden();
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
