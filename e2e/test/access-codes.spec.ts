// access-codes.spec.ts —— owner 通过 admin UI 发码 → 访客拿到码后用它聊。
//
// 用户故事：
//   owner 想让 HR 单独看 work-tagged 那部分 corpus。Admin /codes 页里
//   填 INTRO-001 / "Intro for HR" / tag=work → create。HR 用这个码
//   （/gate UI 落地前，这里仿真 visitor：拿着码直接 POST /api/v1/sessions
//   = code-tier session → chat 流走通）。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI, loginAsOwnerUI } from '@/fixtures/admin';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { issueSession, sendMessage } from '@/fixtures/visitor';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.describe.serial('owner issues an access code in admin; visitor uses it', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await seedTaggedWiki(request);
    await request.dispose();
  });

  test('owner creates INTRO-001 in /admin/codes → visitor chats with that code',
    async ({ page, request }) => {
      await signInAndOpenCodes(page);
      await createCodeInUI(page, 'INTRO-001', 'Intro for HR', 'work');
      await expectCodeRowVisible(page, 'INTRO-001');
      await visitorChatsWithCode(request);
    });
});

async function seedTaggedWiki(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'seed-token');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'I built FlexMesh for Canadian delivery drivers.',
    title: 'Work — FlexMesh',
    tags: ['work'],
  });
}

async function signInAndOpenCodes(page: Page): Promise<void> {
  await loginAsOwnerUI(page);
  await gotoAdminSection(page, 'codes');
  await page.waitForURL('**/admin/codes', { timeout: 5_000 });
}

async function createCodeInUI(
  page: Page, code: string, label: string, tags: string,
): Promise<void> {
  // /admin/codes UI 现在用 modal 打开创建表单；先点 "+ new code"。
  await page.getByRole('button', { name: /new code/i }).click();
  await page.getByTestId('code-input').fill(code);
  await page.getByTestId('code-label').fill(label);
  await page.getByTestId('code-tags').fill(tags);
  await page.getByTestId('code-create').click();
}

async function expectCodeRowVisible(page: Page, code: string): Promise<void> {
  await expect(page.getByTestId(`code-row-${code}`)).toBeVisible({ timeout: 5_000 });
}

// visitor 拿码聊 —— 还没 /gate UI，所以 visitor 这一侧仿真；gate UI 落地
// 后改成 UI-driven。
async function visitorChatsWithCode(request: APIRequestContext): Promise<void> {
  const sess = await issueSession(request, {
    handle: OWNER.handle, code: 'INTRO-001', visitor_name: 'HR',
  });
  expect(sess.included_tags).toContain('work');
  const res = await sendMessage(request, sess, 'tell me about your work');
  expect(res.status()).toBe(200);
}
