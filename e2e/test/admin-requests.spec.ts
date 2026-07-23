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
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { configureMailConnector } from '@/fixtures/mail';
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
    await seedRequestsOwner(playwright);
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

  // #155: the generic /credentials store no longer validates per-connector
  // fields (that lives in the form + the connection test). Saving empty SMTP
  // creds succeeds; connect then uniformly returns 200 reporting the outcome in
  // the body — the POST is well-formed, the stored config just can't connect,
  // so it's connected:false + a reason (same shape as the oauth 200+authURL
  // path), not an HTTP 4xx.
  test('connect reports not-connected (200 + reason) when SMTP host is missing',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      const saved = await request.post(`${BACKEND}/api/admin/connectors/smtp/credentials`, {
        headers: { 'X-Csrftoken': csrf },
        data: { host: '', port: '0', username: '', password: '', from_address: '', from_name: '' },
      });
      expect(saved.status()).toBe(200);
      const connected = await request.post(`${BACKEND}/api/admin/connectors/smtp/connect`, {
        headers: { 'X-Csrftoken': csrf },
      });
      expect(connected.status()).toBe(200);
      const body = await connected.json() as { connected: boolean; error: string };
      expect(body.connected).toBe(false);
      expect(body.error.length).toBeGreaterThan(0);
      await request.dispose();
    });
});

// F-C-7: once a real mail connector (id `smtp`, category `mail`) is connected+active, the
// requests approve-gate AND the account recovery-gate must un-gate. Regression caught on real
// prod: the gates read the DEAD `/connectors/mail/status` (id `mail`) so they stayed locked
// even with a working, delivering SMTP connector. The mock served id=`mail` as connected, so
// no prior spec exercised the real id split — this drives the GUI gate with a real connect.
const MAIL_OWNER = {
  email: 'requests-mailon@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'requestsmailon',
  fullName: 'Requests MailOn Owner',
};

test.describe('admin requests · mail connected un-gates approve (F-C-7)', () => {
  test.use({ ownerCredentials: { email: MAIL_OWNER.email, password: MAIL_OWNER.password } });

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: MAIL_OWNER.email, password: MAIL_OWNER.password,
      handle: MAIL_OWNER.handle, fullName: MAIL_OWNER.fullName,
    });
    await submitRequestViaAPI(request);
    await configureMailConnector(request, MAIL_OWNER.email, MAIL_OWNER.password);
    await request.dispose();
  });

  test('requests: mail connected → hint gone, approve available',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'requests');
      await adminPage.waitForURL('**/admin/requests', { timeout: 5_000 });
      // the "connect mail" hint must be absent now that a mail connector is live
      await expect(adminPage.getByTestId('requests-mail-hint')).toHaveCount(0);
      await expect(adminPage.getByRole('button', { name: /approve/i }).first())
        .toBeVisible({ timeout: 5_000 });
    });

  test('account: mail connected → recovery-phrase generate enabled',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'account');
      await adminPage.waitForURL('**/admin/account', { timeout: 5_000 });
      await expect(adminPage.getByTestId('recovery-generate')).toBeEnabled({ timeout: 5_000 });
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

// seedRequestsOwner —— claim owner + 播一条访客请求。抽出 describe 让其体 ≤70 行。
async function seedRequestsOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await submitRequestViaAPI(request);
  await request.dispose();
}
