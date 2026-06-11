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

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

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

  test('gate hides the request-access block without a verified mail connector',
    async ({ page }) => {
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      await expect(page.getByRole('button', { name: /write a note/i })).toHaveCount(0);
      await expect(page.getByTestId('request-name')).toHaveCount(0);
    });

  test('approve endpoint rejects (400) without a verified mail connector',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const id = await firstRequestID(request);
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      const res = await request.post(`${BACKEND}/api/admin/access-requests/${id}/approve`, {
        headers: { 'X-Csrftoken': csrf }, data: {},
      });
      expect(res.status()).toBe(400);
      await request.dispose();
    });

  test('save mail credentials rejects (400) when host is missing',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      const res = await request.post(`${BACKEND}/api/admin/connectors/mail/credentials`, {
        headers: { 'X-Csrftoken': csrf },
        data: { host: '', port: 0, from_address: '' },
      });
      expect(res.status()).toBe(400);
      await request.dispose();
    });
});

async function firstRequestID(request: APIRequestContext): Promise<string> {
  await login(request, OWNER.email, OWNER.password);
  const res = await request.get(`${BACKEND}/api/admin/access-requests`);
  const rows = await res.json() as { id: string }[];
  if (rows.length === 0) throw new Error('no seeded request to approve');
  return rows[0]!.id;
}

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
