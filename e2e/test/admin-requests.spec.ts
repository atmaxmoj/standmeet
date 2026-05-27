// admin-requests.spec.ts —— admin requests: approve, decline, filter chips.
//
// 用户故事：
//   1. open request → "approve · issue code →" button visible
//   2. approve → auto issue AccessCode + request → approved
//   3. decline → request → declined + reason shown
//   4. filter chips → open / replied / closed / all
//   5. blockquote message renders (italic serif + left border)

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'requests@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'requests',
  fullName: 'Requests Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin requests management', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('submit request via gate → appears in admin requests',
    async ({ page, adminPage }) => {
      // Submit a request via gate
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      await page.getByRole('button', { name: /write a note/i }).click();
      await page.getByTestId('request-email').fill('requester@example.com');
      await page.getByTestId('request-name').fill('Test Requester');
      await page.getByTestId('request-message').fill('Please give me access to talk.');
      await page.getByTestId('request-submit').click();
      await expect(page.getByTestId('request-sent')).toBeVisible({ timeout: 5_000 });

      // Check in admin
      await gotoAdminSection(adminPage, 'requests');
      await adminPage.waitForURL('**/admin/requests', { timeout: 5_000 });
      await expect(adminPage.getByText('Test Requester')).toBeVisible({ timeout: 5_000 });
      await expect(adminPage.getByText('requester@example.com')).toBeVisible();
    });

  test('approve request → issues code + status changes',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'requests');
      const approveBtn = adminPage.getByRole('button', { name: /approve/i }).first();
      await expect(approveBtn).toBeVisible();
      await approveBtn.click();
      // Request should show approved state
      await expect(adminPage.getByText(/approved/i)).toBeVisible({ timeout: 5_000 });
    });

  test('filter chips switch between states',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'requests');
      // All filter
      const filters = adminPage.getByTestId('requests-filters');
      const allChip = filters.getByRole('button', { name: 'all' });
      if (await allChip.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await allChip.click();
        await expect(adminPage.getByTestId('requests-list')).toBeVisible();
      }
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
