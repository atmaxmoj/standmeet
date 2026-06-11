// admin-requests.spec.ts —— admin requests: seeded request appears, approve
// gated on a verified mail connector, filter chips work.
//
// 用户故事：
//   1. request seeded via API → appears in admin list
//   2. WITHOUT a verified mail connector: no approve button, a "connect mail"
//      hint shows instead (can't issue + email a code you can't send). The
//      positive approve→issue→email path is covered by the Mailpit closed-loop
//      spec (mail-connector.spec.ts).
//   3. filter chips switch between states

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

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
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await submitRequestViaAPI(request);
    await request.dispose();
  });

  test('seeded request appears in admin list',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'requests');
      await adminPage.waitForURL('**/admin/requests', { timeout: 5_000 });
      await expect(adminPage.getByText('API Requester')).toBeVisible({ timeout: 5_000 });
      await expect(adminPage.getByText('apitest@example.com')).toBeVisible();
    });

  test('no approve button without a verified mail connector',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'requests');
      await adminPage.waitForURL('**/admin/requests', { timeout: 5_000 });
      await expect(adminPage.getByTestId('requests-mail-hint')).toBeVisible({ timeout: 5_000 });
      const approveBtn = adminPage.getByRole('button', { name: /approve/i });
      await expect(approveBtn).toHaveCount(0);
    });

  test('filter chips switch between states',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'requests');
      const filters = adminPage.getByTestId('requests-filters');
      await expect(filters).toBeVisible();
      const allChip = filters.getByRole('button', { name: 'all' });
      await allChip.click();
      await expect(adminPage.getByTestId('requests-list')).toBeVisible();
    });
});

async function submitRequestViaAPI(request: APIRequestContext): Promise<void> {
  await request.post('/api/v1/access-requests', {
    data: {
      name: 'API Requester',
      org: 'Test Corp',
      email: 'apitest@example.com',
      message: 'I want to talk about your projects and get access to the corpus.',
    },
  });
}
