// code-self-test.spec.ts —— owner 在 /admin/codes 卡片里直接试一聊。
//
// 用户故事：
//   owner 不想再开隐身浏览器假装访客。点 code 卡的 "preview" → modal 里
//   "test this code" → 起一个 session（visitor_name = "(owner test)"）
//   → 发一条 message → 看 streamed reply。
//   /admin/conversations 里也能看到这条 "(owner test)" 对话作证。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const CODE = 'TEST-001';

test.describe.serial('owner self-tests a code from /admin/codes preview', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await issueCodeForTesting(request);
    await request.dispose();
  });

  test('preview modal opens, "test this code" runs a streaming reply',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'codes');
      await openPreviewModal(page);
      await runSelfTest(page, 'tell me about your work');
      await assertTestConversationLogged(page);
    });
});

async function issueCodeForTesting(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await createAPIToken(request, csrf, 'noop-token');
  await createCode(request, csrf, {
    code: CODE,
    label: 'Self-test code',
    purpose: 'code-self-test spec',

  });
}

async function openPreviewModal(page: Page): Promise<void> {
  await page.getByTestId(`code-card-${CODE}`)
    .getByRole('button', { name: /preview/ }).click();
  await expect(page.getByText(/test this code/)).toBeVisible();
}

async function runSelfTest(page: Page, prompt: string): Promise<void> {
  await page.getByTestId('code-self-test-start').click();
  await expect(page.getByTestId('code-self-test-input')).toBeVisible();
  await page.getByTestId('code-self-test-input').fill(prompt);
  await page.getByTestId('code-self-test-send').click();
  // mock provider 流出几个 chunk 后定型；reply 出现即可。
  await expect(page.getByTestId('code-self-test-reply')).toBeVisible({ timeout: 15_000 });
}

async function assertTestConversationLogged(page: Page): Promise<void> {
  // 关掉 preview modal，否则会挡 sidebar 链接。
  await page.getByRole('button', { name: /close/ }).click();
  await gotoAdminSection(page, 'conversations');
  await page.waitForURL('**/admin/conversations', { timeout: 5_000 });
  // owner 这次对话的 visitor_name = "(owner test)"，应该出现在 list 里。
  await expect(page.getByText('(owner test)')).toBeVisible();
}
