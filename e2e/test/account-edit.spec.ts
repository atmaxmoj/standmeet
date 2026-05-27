// account-edit.spec.ts —— /admin/account 三个 form：full_name / email /
// password。改完都从 /me 回读，写回 sessionStore；password 改完用新密码登一次。
//
// 用户故事：
//   owner 想把展示用的 full_name 改成更口语化的名字；改邮箱（先验当前
//   密码）；改密码（再验当前密码 + 二次确认）。三件互不影响 session。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const NEW_FULL_NAME = 'Alice A.';
const NEW_EMAIL = 'alice+rotated@example.com';
const NEW_PASSWORD = 'new-correct-horse-12345';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('owner edits account fields post-claim', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('full name → email → password, each saved and re-readable',
    async ({ adminPage: page, playwright }) => {
      await gotoAdminSection(page, 'account');
      await page.waitForURL('**/admin/account', { timeout: 5_000 });

      await editFullName(page, NEW_FULL_NAME);
      await editEmail(page, OWNER.password, NEW_EMAIL);
      await editPassword(page, OWNER.password, NEW_PASSWORD);

      // 用新邮箱 + 新密码登一次 API 验证后端真的换了
      const request = await playwright.request.newContext();
      const fresh = await loginAPI(request, NEW_EMAIL, NEW_PASSWORD);
      expect(fresh.csrf).toBeTruthy();
      await request.dispose();
    });
});

async function editFullName(page: Page, name: string): Promise<void> {
  const input = page.getByTestId('account-full-name-input');
  await input.fill(name);
  await page.getByTestId('account-full-name-save').click();
  await expect(page.getByTestId('toast-success').filter({ hasText: name })).toBeVisible();
  // 刷新后 SectionHeader / FullNameBlock 应从 /me 重新读到新值
  await page.reload();
  await expect(page.getByTestId('account-full-name-input')).toHaveValue(name);
}

async function editEmail(page: Page, currentPwd: string, newEmail: string): Promise<void> {
  await page.getByTestId('account-email-current-password').fill(currentPwd);
  await page.getByTestId('account-email-new').fill(newEmail);
  await page.getByTestId('account-email-save').click();
  await expect(page.getByTestId('toast-success').filter({ hasText: newEmail })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('account-email-new')).toHaveValue(newEmail);
}

async function editPassword(page: Page, currentPwd: string, newPwd: string): Promise<void> {
  await page.getByTestId('account-password-current').fill(currentPwd);
  await page.getByTestId('account-password-new').fill(newPwd);
  await page.getByTestId('account-password-confirm').fill(newPwd);
  await page.getByTestId('account-password-save').click();
  await expect(page.getByTestId('toast-success').filter({ hasText: /password updated/i }))
    .toBeVisible();
  // 字段被清空
  await expect(page.getByTestId('account-password-current')).toHaveValue('');
}

