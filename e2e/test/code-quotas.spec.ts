// code-quotas.spec.ts —— owner 给 access code 设配额、之后 revoke 整个码。
//
// 用户故事：
//   owner 给招聘官发 INTERVIEW-A1，每人 5 轮面试 × 每轮 10 个回合。
//   面试结束后想关闭整个码，点 revoke。访客再用旧链接就被拒。

import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { goto, gotoAdminSection } from '@/fixtures/navigate';
import { issueSessionStatus } from '@/fixtures/visitor';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const CODE = 'INTERVIEW-A1';

test.describe.serial('owner sets quotas on access code and revokes it', () => {
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
    async ({ page, request }) => {
      await signInAndOpenCodes(page);
      await createCodeWithQuotas(page, CODE, 'Interview round A', '5', '10');
      await expectQuotaLineVisible(page, CODE, '5', '10');
      await editQuotas(page, CODE, '7', '20');
      await expectQuotaLineVisible(page, CODE, '7', '20');
      await revokeCode(page, CODE);
      await expectRevokedRow(page, CODE);
      await expectRevokedSessionRejected(request);
    });
});

async function editQuotas(
  page: Page, code: string, sessions: string, turns: string,
): Promise<void> {
  // click the card's "edit" Btn (unique kind=outline / text=edit on this card).
  const card = page.getByTestId(`code-card-${code}`);
  await card.getByRole('button', { name: 'edit', exact: true }).click();
  await page.getByTestId('code-max-sessions').fill(sessions);
  await page.getByTestId('code-max-turns').fill(turns);
  await page.getByTestId('code-save').click();
  await expect(page.getByTestId('toast-success').filter({ hasText: 'Quotas updated' }))
    .toBeVisible();
}

async function signInAndOpenCodes(page: Page): Promise<void> {
  await goto(page, '/login');
  await page.getByTestId('email').fill(OWNER.email);
  await page.getByTestId('password').fill(OWNER.password);
  await page.getByTestId('submit').click();
  await page.waitForURL('**/admin/page', { timeout: 10_000 });
  await gotoAdminSection(page, 'codes');
  await page.waitForURL('**/admin/codes', { timeout: 5_000 });
}

async function createCodeWithQuotas(
  page: Page, code: string, label: string, sessions: string, turns: string,
): Promise<void> {
  await page.getByRole('button', { name: /new code/i }).click();
  await page.getByTestId('code-input').fill(code);
  await page.getByTestId('code-label').fill(label);
  await page.getByTestId('code-max-sessions').fill(sessions);
  await page.getByTestId('code-max-turns').fill(turns);
  await page.getByTestId('code-create').click();
  await expect(page.getByTestId(`code-row-${code}`)).toBeVisible({ timeout: 5_000 });
}

async function expectQuotaLineVisible(
  page: Page, code: string, sessions: string, turns: string,
): Promise<void> {
  const line = page.getByTestId(`code-quotas-${code}`);
  await expect(line).toBeVisible();
  await expect(line).toContainText(`${sessions} sessions/visitor`);
  await expect(line).toContainText(`${turns} turns/session`);
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
