// owner-login.spec.ts —— owner 已经 claim 过实例之后的 sign-in 流程。
//
// 用户故事：
//   owner 之前已经 claim 完，关浏览器后第二次回来。地址栏输 /admin → server
//   见无 session redirect 到 /login → 填邮箱密码 → submit → 落 /admin/page。
//   错密码会显示 inline 错误，不离开 /login。
//
// Claim 走 API helper（不是被测路径）；login 全程浏览器。两个 case 共享
// "navigateToOwnerLogin"（fixture-level goto /admin → 自动 redirect /login）。

import { test, expect } from '@/fixtures/test';

import { claim, navigateToOwnerLogin } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

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

  test('right credentials land owner in admin', async ({ adminPage: page }) => {
    // adminPage fixture 自己跑完 owner-typed /admin → /login → 填表单 → /admin/page。
    // 这里只断言落点正确（admin sidebar 渲染了）。
    await expect(page.getByTestId('admin-nav-page')).toBeVisible();
  });

  test('wrong password shows inline error, stays on /login', async ({ page }) => {
    await navigateToOwnerLogin(page);
    await page.getByTestId('email').fill(OWNER.email);
    await page.getByTestId('password').fill('not-the-password');
    await page.getByTestId('submit').click();
    await expect(page.getByTestId('error')).toBeVisible({ timeout: 5_000 });
    await expect(page).toHaveURL(/.*\/login$/);
  });
});
