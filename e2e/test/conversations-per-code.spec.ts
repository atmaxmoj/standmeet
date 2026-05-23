// conversations-per-code.spec.ts —— owner 在 admin code 卡片点 "view
// conversations" → 跳到 /admin/conversations?code=... → 只看到该 code 下的
// session。
//
// 用户故事：
//   owner 发了两个 code，一个给招聘官，一个给投资人。想看招聘官那个 code
//   下的对话，从卡里直接跳过去即可，不用在大列表里肉眼挑。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';
import { issueSession, sendMessage } from '@/fixtures/visitor';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const HR_CODE = 'HR-001';
const INV_CODE = 'INV-001';

test.describe.serial('admin filters conversations by code via UI link', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await seedCodesAndChats(request);
    await request.dispose();
  });

  test('view conversations link from HR code shows only that code\'s session',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'codes');
      await page.waitForURL('**/admin/codes', { timeout: 5_000 });
      // 两个 code 卡片各有一条 "view conversations" 链接；选 HR 那张卡的。
      await page.getByTestId(`code-card-${HR_CODE}`)
        .getByRole('link', { name: 'view conversations →' }).click();
      await page.waitForURL(`**/admin/conversations?code=${HR_CODE}`, { timeout: 5_000 });

      await expect(page.getByTestId('conv-filter-chip')).toContainText(HR_CODE);
      // visitor name "Recruiter" 走 HR code → 应该出现一行；Investor 那条不该出现。
      // 用 exact 命中渲染的 visitor 名字，避开 "Investor intro" 这种 label 撞名。
      await expect(page.getByText('Recruiter', { exact: true })).toBeVisible();
      await expect(page.getByText('Investor', { exact: true })).toHaveCount(0);

      // 点 "clear ×" → 回到不带 code 的列表，两条都看到。
      await page.getByRole('link', { name: 'clear ×' }).click();
      await page.waitForURL('**/admin/conversations', { timeout: 5_000 });
      await expect(page.getByText('Recruiter', { exact: true })).toBeVisible();
      await expect(page.getByText('Investor', { exact: true })).toBeVisible();
    });
});

async function seedCodesAndChats(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await createAPIToken(request, csrf, 'noop-token');
  await createCode(request, csrf, {
    code: HR_CODE, label: 'HR loop', purpose: 'spec', included_tags: [],
  });
  await createCode(request, csrf, {
    code: INV_CODE, label: 'Investor intro', purpose: 'spec', included_tags: [],
  });
  await chatViaCode(request, HR_CODE, 'Recruiter');
  await chatViaCode(request, INV_CODE, 'Investor');
}

async function chatViaCode(
  request: APIRequestContext, code: string, visitorName: string,
): Promise<void> {
  const sess = await issueSession(request, {
    handle: OWNER.handle, code, visitor_name: visitorName,
  });
  const res = await sendMessage(request, sess, 'hello');
  await res.body();
}

