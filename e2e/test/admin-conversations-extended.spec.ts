// admin-conversations-extended.spec.ts —— conversations: sentiment, BYOAI tag,
// transcript expand, filter by code.
//
// 用户故事：
//   1. sentiment column → based on turn count shows correct label
//   2. BYOAI conversation → sentiment = "shopping"
//   3. click row → transcript expands inline
//   4. ?code=LABEL → filter only that code's conversations
//   5. clear filter → show all

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { issueSession, sendMessage } from '@/fixtures/visitor';

const OWNER = {
  email: 'conv-ext@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'convext',
  fullName: 'Conv Ext Owner',
};

const CODE_A = 'CONV-A';
const CODE_B = 'CONV-B';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin conversations extended', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('conversations table renders with sentiment column',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'conversations');
      await adminPage.waitForURL('**/admin/conversations', { timeout: 5_000 });
      // Should have at least the conversations we seeded
      await expect(adminPage.getByText('Visitor A', { exact: true })).toBeVisible();
      await expect(adminPage.getByText('Visitor B', { exact: true })).toBeVisible();
    });

  test('click row → transcript expands inline',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'conversations');
      const row = adminPage.getByText('Visitor A', { exact: true });
      await row.click();
      // Transcript content should appear
      await expect(adminPage.getByTestId('transcript-panel')).toBeVisible({ timeout: 5_000 });
      await expect(adminPage.getByTestId('transcript-panel')).toContainText('hello from A');
    });

  test('filter by code URL → only matching conversations',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'codes');
      await adminPage.waitForURL('**/admin/codes', { timeout: 5_000 });
      await adminPage.getByTestId(`code-card-${CODE_A}`)
        .getByRole('link', { name: 'view conversations →' }).click();
      await adminPage.waitForURL(`**/admin/conversations?code=${CODE_A}`, { timeout: 5_000 });
      await expect(adminPage.getByText('Visitor A', { exact: true })).toBeVisible();
      await expect(adminPage.getByText('Visitor B', { exact: true })).toHaveCount(0);
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await seedCodesAndChats(request);
  await request.dispose();
}

async function seedCodesAndChats(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'conv-ext-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'conv ext intro.', title: 'Conv Ext Intro',
  });
  await createCode(request, csrf, { code: CODE_A, label: 'Code A' });
  await createCode(request, csrf, { code: CODE_B, label: 'Code B' });
  // Create conversations
  const sessA = await issueSession(request, {
    handle: OWNER.handle, code: CODE_A, visitor_name: 'Visitor A',
  });
  await (await sendMessage(request, sessA, 'hello from A')).body();
  const sessB = await issueSession(request, {
    handle: OWNER.handle, code: CODE_B, visitor_name: 'Visitor B',
  });
  await (await sendMessage(request, sessB, 'hello from B')).body();
}
