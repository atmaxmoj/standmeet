// owner-login.spec.ts —— owner 已经 claim 过实例之后的 sign-in 流程。
//
// 用户故事：
//   owner 之前已经 claim 完，关浏览器后第二次回来。访问 /login 输入邮箱密码，
//   后端写 session cookie，跳回自己的页面 /<handle>。错密码会显示 inline
//   错误，不离开 /login。
//
// Claim 走 helper（不是被测路径）；login 全程浏览器。

import { test, expect } from '@/fixtures/test';

import { claim, loginAsOwnerUI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.describe.serial('owner logs back in', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('right credentials land owner in admin', async ({ page }) => {
    await loginAsOwnerUI(page);
    await expect(page.getByRole('link', { name: /\bpage\b/ })).toBeVisible();
  });

  test('wrong password shows inline error, stays on /login', async ({ page }) => {
    await goto(page, '/login');
    await page.getByTestId('email').fill(OWNER.email);
    await page.getByTestId('password').fill('not-the-password');
    await page.getByTestId('submit').click();
    await expect(page.getByTestId('error')).toBeVisible({ timeout: 5_000 });
    await expect(page).toHaveURL(/.*\/login$/);
  });
});
