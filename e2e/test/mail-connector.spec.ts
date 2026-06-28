// mail-connector.spec.ts —— the access-code email loop, end to end, real SMTP.
//
// 用户故事:owner 配 + verify mail connector (Mailpit) → 访客提交 access request
// → owner approve → access code 邮件经 Mailpit 落到访客邮箱、含正确码 +
// /<page>?code= 链接 → 访客用该码真能开 session。真服务 (Mailpit),无 mock。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { configureMailConnector, clearMailpit, waitForMailTo } from '@/fixtures/mail';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'mailloop@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'mailloop',
  fullName: 'Mail Loop Owner',
};
const RECRUITER = 'recruiter@corp.test';

test.describe('mail connector access-code loop', () => {
  test.beforeAll(async ({ playwright }) => {
    await setup(playwright);
  });

  test('approve a request → code emailed → code opens a session',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const requestID = await seedRequestID(request);
      await clearMailpit(request); // drop the configure-time test email to owner
      const { code, link } = await approve(request, requestID);

      const body = await waitForMailTo(request, RECRUITER);
      expect(body).toContain(code);
      expect(body).toContain(link);

      // closed loop: the recruiter's emailed code actually opens a session.
      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code, visitor_name: 'Recruiter',
      });
      expect(sess.session_token).toBeTruthy();
      await request.dispose();
    });

  test('approve rejects (404) an unknown request id',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      const missing = '00000000-0000-0000-0000-000000000000';
      const res = await request.post(`${BACKEND}/api/admin/access-requests/${missing}/approve`, {
        headers: { 'X-Csrftoken': csrf }, data: {},
      });
      expect(res.status()).toBe(404);
      await request.dispose();
    });

  // Runs last: disconnect removes the connector, so can_email_codes flips back
  // to false and the gate hides its request-access block again.
  test('disconnect → can_email_codes false → gate hides request-access',
    async ({ playwright, page }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      const dis = await request.post(`${BACKEND}/api/admin/connectors/smtp/disconnect`, {
        headers: { 'X-Csrftoken': csrf }, data: {},
      });
      expect(dis.status()).toBe(200);
      const inst = await request.get(`${BACKEND}/api/v1/instance`);
      expect((await inst.json() as { can_email_codes: boolean }).can_email_codes).toBe(false);
      await request.dispose();
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      await expect(page.getByRole('button', { name: /write a note/i })).toHaveCount(0);
    });
});

async function setup(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await configureMailConnector(request, OWNER.email, OWNER.password);
  await request.dispose();
}

async function seedRequestID(request: APIRequestContext): Promise<string> {
  await request.post(`${BACKEND}/api/v1/access-requests`, {
    data: {
      name: 'Recruiter', org: 'Corp', email: RECRUITER,
      message: 'I would like access to talk about a backend role.',
    },
  });
  await login(request, OWNER.email, OWNER.password);
  const res = await request.get(`${BACKEND}/api/admin/access-requests`);
  const rows = await res.json() as { id: string; email: string }[];
  const hit = rows.find((r) => r.email === RECRUITER);
  if (!hit) throw new Error('seeded access request not found in admin list');
  return hit.id;
}

async function approve(
  request: APIRequestContext, id: string,
): Promise<{ code: string; link: string }> {
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  const res = await request.post(
    `${BACKEND}/api/admin/access-requests/${id}/approve`,
    { headers: { 'X-Csrftoken': csrf }, data: {} },
  );
  if (res.status() !== 200) {
    throw new Error(`approve failed: ${res.status()} ${await res.text()}`);
  }
  return await res.json() as { code: string; link: string };
}
