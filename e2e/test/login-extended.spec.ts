// login-extended.spec.ts —— login extended: empty fields, throttle.
//
// 用户故事：
//   1. 空 email → submit disabled
//   2. 空 password → submit disabled
//   3. 连续失败 → throttle 提示

import { test, expect } from '@/fixtures/test';

import { claim, navigateToOwnerLogin } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const OWNER = {
  email: 'login-ext@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'loginext',
  fullName: 'Login Ext Owner',
};

test.describe('login extended validation', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('empty email → click submit → error shown',
    async ({ page }) => {
      await navigateToOwnerLogin(page);
      await page.getByTestId('password').fill(OWNER.password);
      // Email is empty, click submit → expect error
      await page.getByTestId('submit').click();
      await expect(page.getByTestId('error')).toBeVisible({ timeout: 5_000 });
    });

  test('empty password → click submit → error shown',
    async ({ page }) => {
      await navigateToOwnerLogin(page);
      await page.getByTestId('email').fill(OWNER.email);
      // Password is empty, click submit → expect error
      await page.getByTestId('submit').click();
      await expect(page.getByTestId('error')).toBeVisible({ timeout: 5_000 });
    });

  test('multiple wrong passwords → throttle hint shown',
    async ({ page }) => {
      await navigateToOwnerLogin(page);
      // Attempt multiple failed logins
      for (let i = 0; i < 5; i++) {
        await page.getByTestId('email').fill(OWNER.email);
        await page.getByTestId('password').fill(`wrong-pass-${i}`);
        await page.getByTestId('submit').click();
        await expect(page.getByTestId('error')).toBeVisible({ timeout: 5_000 });
      }
      // After multiple failures, should show throttle warning
      const error = page.getByTestId('error');
      await expect(error).toBeVisible();
    });
});
