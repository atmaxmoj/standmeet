// code-quotas.spec.ts —— owner 给 access code 设配额、之后 revoke 整个码。
//
// 用户故事：
//   owner 给招聘官发 INTERVIEW-A1，每人 5 轮面试 × 每轮 10 个回合。
//   面试结束后想关闭整个码，点 revoke。访客再用旧链接就被拒。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';
import { issueSession, issueSessionStatus } from '@/fixtures/visitor';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const CODE = 'INTERVIEW-A1';
const USED_CODE = 'INTERVIEW-A2';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('owner sets quotas on access code and revokes it', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('owner creates code with quotas, edits them, then revokes',
    async ({ adminPage: page, request }) => {
      await openCodes(page);
      await createCodeWithQuotas(page, CODE, 'Interview round A', '5', '10');
      await expectQuotaLineVisible(page, CODE, '5', '10');
      await editQuotas(page, CODE, '7', '20');
      await expectQuotaLineVisible(page, CODE, '7', '20');
      await revokeCode(page, CODE);
      await expectRevokedRow(page, CODE);
      await expectRevokedSessionRejected(request);
    });

  // F-D-2 —— 配额行只说得出上限，说不出用量，所以满员的码跟全新的码长得一模一样。
  // 上面那条用例只断言 "N names"（**上限**），带成员的码这条分支从没被驱动过，
  // 于是 owner 侧看不见任何用量、访客那边却被拒。访客顶栏早就渲染 "1 / 5 names"。
  test('the quota line reports consumption, not just the cap',
    async ({ adminPage: page, request }) => {
      await openCodes(page);
      await createCodeWithQuotas(page, USED_CODE, 'Used code', '5', '10');
      await expectQuotaLineVisible(page, USED_CODE, '5', '10');

      // 两个不同的名字进来 —— 这个码现在 2/5。
      await issueSession(request, { handle: OWNER.handle, code: USED_CODE, visitor_name: 'Dana' });
      await issueSession(request, { handle: OWNER.handle, code: USED_CODE, visitor_name: 'Sam' });

      await page.reload();
      const line = page.getByTestId(`code-quotas-${USED_CODE}`);
      await expect(line, '两个人进来之后，配额行说得出用了几个名额').toContainText('2 / 5');
    });
});

async function editQuotas(
  page: Page, code: string, sessions: string, turns: string,
): Promise<void> {
  // click the card's "edit" Btn (unique kind=outline / text=edit on this card).
  const card = page.getByTestId(`code-card-${code}`);
  await card.getByRole('button', { name: 'edit', exact: true }).click();
  await page.getByTestId('code-max-members').fill(sessions);
  await page.getByTestId('code-max-turns').fill(turns);
  await page.getByTestId('code-save').click();
  await expect(page.getByTestId('toast-success').filter({ hasText: 'Quotas updated' }))
    .toBeVisible();
}

async function openCodes(page: Page): Promise<void> {
  await gotoAdminSection(page, 'codes');
  await page.waitForURL('**/admin/codes', { timeout: 5_000 });
}

async function createCodeWithQuotas(
  page: Page, code: string, label: string, sessions: string, turns: string,
): Promise<void> {
  await page.getByRole('button', { name: /new code/i }).click();
  await page.getByTestId('code-input').fill(code);
  await page.getByTestId('code-label').fill(label);
  await page.getByTestId('code-max-members').fill(sessions);
  await page.getByTestId('code-max-turns').fill(turns);
  await page.getByTestId('code-create').click();
  await expect(page.getByTestId(`code-row-${code}`)).toBeVisible({ timeout: 5_000 });
}

async function expectQuotaLineVisible(
  page: Page, code: string, sessions: string, turns: string,
): Promise<void> {
  const line = page.getByTestId(`code-quotas-${code}`);
  await expect(line).toBeVisible();
  await expect(line).toContainText(`${sessions} names`);
  await expect(line).toContainText(`${turns} turns`);
}

async function revokeCode(page: Page, code: string): Promise<void> {
  await page.getByTestId(`code-revoke-${code}`).click();
  await expect(page.getByTestId(`code-revoke-${code}`)).toHaveCount(0, { timeout: 5_000 });
  // create 的 toast 可能没消失，按文本筛具体那条 success toast。
  await expect(page.getByTestId('toast-success').filter({ hasText: 'Code revoked' }))
    .toBeVisible();
}

async function expectRevokedRow(page: Page, code: string): Promise<void> {
  const card = page.getByTestId(`code-card-${code}`);
  await expect(card).toContainText('revoked');
}

async function expectRevokedSessionRejected(request: APIRequestContext): Promise<void> {
  const status = await issueSessionStatus(request, {
    handle: OWNER.handle, code: CODE, visitor_name: 'HR',
  });
  expect(status).not.toBe(200);
}
