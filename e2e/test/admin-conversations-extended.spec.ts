// admin-conversations-extended.spec.ts —— conversations: sentiment column,
// transcript modal, filter by code.

import { test, expect } from '@/fixtures/test';
import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { goto, gotoAdminSection } from '@/fixtures/navigate';
import { issueSession, sendMessage } from '@/fixtures/visitor';

const OWNER = {
  email: 'conv-ext@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'convext',
  fullName: 'Conv Ext Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('admin conversations extended', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const apiToken = await createAPIToken(request, csrf, 'conv-ext-seed');
    const sid = await initMCP(request, apiToken);
    await seedPublicWiki(request, apiToken, sid, {
      body: 'conv ext intro.', title: 'Conv Ext Intro',
    });
    await createCode(request, csrf, { code: 'CONV-A', label: 'Code A' });
    await createCode(request, csrf, { code: 'CONV-B', label: 'Code B' });
    const sessA = await issueSession(request, {
      handle: OWNER.handle, code: 'CONV-A', visitor_name: 'Visitor A',
    });
    await (await sendMessage(request, sessA, 'hello from A')).body();
    const sessB = await issueSession(request, {
      handle: OWNER.handle, code: 'CONV-B', visitor_name: 'Visitor B',
    });
    await (await sendMessage(request, sessB, 'hello from B')).body();
    await request.dispose();
  });

  test('conversations table renders with sentiment column',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'conversations');
      await adminPage.waitForURL('**/admin/conversations', { timeout: 5_000 });
      await expect(adminPage.getByText('Visitor A', { exact: true })).toBeVisible();
      await expect(adminPage.getByText('Visitor B', { exact: true })).toBeVisible();
      await expect(adminPage.getByRole('columnheader', { name: 'sentiment' })).toBeVisible();
    });

  test('click row → transcript modal opens with seeded message',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'conversations');
      await adminPage.getByText('Visitor A', { exact: true }).click();
      const body = adminPage.getByTestId('transcript-body');
      await expect(body).toBeVisible({ timeout: 5_000 });
      await expect(body).toContainText('hello from A');
    });

  // 转录只有 modal 一个真表面;删掉那个读空 conv.transcript 恒显 "placeholder for now"
  // 的冗余内联 panel(点行同时弹 modal + 展开占位是 bug)。
  test('opening a conversation shows NO leftover transcript placeholder panel',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'conversations');
      await adminPage.getByText('Visitor A', { exact: true }).click();
      await expect(adminPage.getByTestId('transcript-body')).toBeVisible({ timeout: 5_000 });
      await expect(adminPage.getByText(/transcript not loaded|placeholder for now/i))
        .toHaveCount(0);
    });

  test('filter by code → only matching conversations',
    async ({ adminPage }) => {
      await goto(adminPage, `/admin/conversations?code=CONV-A`);
      await expect(adminPage.getByText('Visitor A', { exact: true })).toBeVisible();
      await expect(adminPage.getByText('Visitor B', { exact: true })).toHaveCount(0);
    });
});
