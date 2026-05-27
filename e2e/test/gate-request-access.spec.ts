// gate-request-access.spec.ts —— gate request access form: validation + submit.
//
// 用户故事：
//   1. 空 email → 不让提交
//   2. 重复提交 → disabled 防重发
//   3. 提交后 → "sent, we'll get back to you" 状态

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const OWNER = {
  email: 'gate-req@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'gatereq',
  fullName: 'Gate Request Owner',
};

test.describe('gate request access form', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('empty email → submit disabled',
    async ({ page }) => {
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      // Open the request form (collapsed by default)
      await page.getByRole('button', { name: /write a note/i }).click();
      // Fill name but not email
      await page.getByTestId('request-name').fill('Test User');
      await page.getByTestId('request-message').fill('I need access to your corpus for research.');
      const submitBtn = page.getByTestId('request-submit');
      await expect(submitBtn).toBeDisabled();
    });

  test('valid form submit → sent confirmation shown',
    async ({ page }) => {
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      await page.getByRole('button', { name: /write a note/i }).click();
      await page.getByTestId('request-email').fill('visitor@example.com');
      await page.getByTestId('request-name').fill('Test Visitor');
      await page.getByTestId('request-message').fill('I would like access please for research.');
      await page.getByTestId('request-submit').click();
      // Confirmation message
      await expect(page.getByTestId('request-sent')).toBeVisible({ timeout: 5_000 });
    });

  test('double submit → button disabled after first submit',
    async ({ page }) => {
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      await page.getByRole('button', { name: /write a note/i }).click();
      await page.getByTestId('request-email').fill('double@example.com');
      await page.getByTestId('request-name').fill('Double Submitter');
      await page.getByTestId('request-message').fill('Please give me access, I am interested.');
      await page.getByTestId('request-submit').click();
      // After submission, submit button should be disabled
      await expect(page.getByTestId('request-submit')).toBeDisabled({ timeout: 3_000 });
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}
