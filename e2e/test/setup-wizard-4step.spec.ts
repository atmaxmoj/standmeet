// setup-wizard-4step.spec.ts —— first-run claim 的 4-step 向导。
//
// 业务故事：
//   step 1 identity → step 2 credentials → step 3 AI provider (可跳过) →
//   step 4 verify (arithmetic captcha + summary 卡) → submit → /admin。
//   step progress bar 4 段；back / next / submit 按钮 testid 跨 step 复用。
//
// Playwright test isolation：每个 test 拿到的是 fresh page (即使
// describe.serial)。每个 case 自己走完前置 steps，避免假设跨 case 状态共享。

import type { Page } from '@playwright/test';

import { resetInstance } from '@/fixtures/instance';
import { test, expect } from '@/fixtures/test';

const OWNER = {
  full: 'Sijie Wang',
  handle: 'sijie',
  publicUrl: 'http://localhost:38127',
  email: 'sijie@example.com',
  password: 'correct-horse-battery-staple',
};

test.describe('first-run claim · 4-step wizard polish', () => {
  test.beforeEach(() => { resetInstance(); });

  test('step 1 missing fields → next disabled; fill → enabled + advance',
    async ({ page }) => {
      await page.waitForURL(/\/setup\?t=/, { timeout: 10_000 });
      const nextBtn = page.getByTestId('next');
      await expect(nextBtn).toBeDisabled();
      await fillStep1(page);
      await expect(nextBtn).toBeEnabled();
      await nextBtn.click();
      await expect(page.getByTestId('email')).toBeVisible({ timeout: 5_000 });
    });

  test('step 2 password mismatch error; correct → step 3',
    async ({ page }) => {
      await page.waitForURL(/\/setup\?t=/, { timeout: 10_000 });
      await fillStep1(page);
      await page.getByTestId('next').click();
      await page.getByTestId('email').fill(OWNER.email);
      await page.getByTestId('password').fill(OWNER.password);
      await page.getByTestId('password-confirm').fill('wrong');
      await page.getByTestId('next').click();
      await expect(page.getByTestId('error')).toContainText(/don.t match/i);
      await page.getByTestId('password-confirm').fill(OWNER.password);
      await page.getByTestId('next').click();
      await expect(page.getByTestId('setup-ai-key')).toBeVisible({ timeout: 5_000 });
    });

  test('full flow with captcha → /admin',
    async ({ page }) => {
      await page.waitForURL(/\/setup\?t=/, { timeout: 10_000 });
      await fillStep1(page);
      await page.getByTestId('next').click();
      await fillStep2(page);
      await page.getByTestId('next').click();
      await page.getByTestId('next').click(); // skip provider
      await answerCaptchaAndSubmit(page);
      // /admin 落地 = dashboard（app/admin/page.tsx 的 server redirect）。
      await page.waitForURL('**/admin/dashboard', { timeout: 10_000 });
    });

  test('wrong captcha → error, stays on /setup',
    async ({ page }) => {
      await page.waitForURL(/\/setup\?t=/, { timeout: 10_000 });
      await fillStep1(page);
      await page.getByTestId('next').click();
      await fillStep2(page);
      await page.getByTestId('next').click();
      await page.getByTestId('next').click();
      await page.getByTestId('setup-captcha').fill('999');
      await page.getByTestId('submit').click();
      await expect(page.getByTestId('error')).toContainText(/captcha/i);
      expect(page.url()).toMatch(/\/setup\?t=/);
    });
});

async function fillStep1(page: Page): Promise<void> {
  await page.getByTestId('full').fill(OWNER.full);
  await page.getByTestId('handle').fill(OWNER.handle);
  await page.getByTestId('public-url').fill(OWNER.publicUrl);
}

async function fillStep2(page: Page): Promise<void> {
  await page.getByTestId('email').fill(OWNER.email);
  await page.getByTestId('password').fill(OWNER.password);
  await page.getByTestId('password-confirm').fill(OWNER.password);
}

async function answerCaptchaAndSubmit(page: Page): Promise<void> {
  const captchaText = await page.locator('text=/^\\s*\\d+\\s*\\+\\s*\\d+\\s*=/').first().textContent();
  const m = (captchaText ?? '').match(/(\d+)\s*\+\s*(\d+)/);
  if (!m) throw new Error('captcha question not found');
  const answer = String(Number(m[1]) + Number(m[2]));
  await page.getByTestId('setup-captcha').fill(answer);
  await page.getByTestId('submit').click();
}
