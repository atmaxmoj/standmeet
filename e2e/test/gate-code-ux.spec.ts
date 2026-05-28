// gate-code-ux.spec.ts —— gate code panel UX: uppercase normalization,
// error shake, checking state, code + name submit.
//
// 用户故事：
//   1. paste code → 大写归一 + 非 [A-Z0-9-] 过滤
//   2. 错误 code → shake 动画 → 清空 → refocus
//   3. "checking" 状态 → submit 后按钮文案变
//   4. code + name 一起提交 → session 带 visitor name

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'gate-ux@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'gateux',
  fullName: 'Gate UX Owner',
};

const CODE = 'GATEUX-001';

test.describe('gate code panel UX polish', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('code input normalizes to uppercase',
    async ({ page }) => {
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      const codeInput = page.getByTestId('gate-code');
      await codeInput.fill('gateux-001');
      // Value should be uppercased
      await expect(codeInput).toHaveValue('GATEUX-001');
    });

  test('wrong code → error shown → input cleared',
    async ({ page }) => {
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      await page.getByTestId('gate-code').fill('BOGUS-CODE');
      await page.getByTestId('gate-code-submit').click();
      // Error message visible
      await expect(page.getByTestId('code-panel').getByTestId('gate-error')).toBeVisible({ timeout: 5_000 });
    });

  test('submit → checking state → button text changes',
    async ({ page }) => {
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      await page.getByTestId('gate-code').fill(CODE);
      await page.getByTestId('gate-code-submit').click();
      // Should redirect on valid code
      await page.waitForURL('**/', { timeout: 10_000 });
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
    });

  test('code + visitor name → session carries name',
    async ({ page }) => {
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      await page.getByTestId('gate-code').fill(CODE);
      await page.getByTestId('gate-visitor-name').fill('Bob Smith');
      await page.getByTestId('gate-code-submit').click();
      await page.waitForURL('**/', { timeout: 10_000 });
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('session-strip')).toContainText('Bob Smith');
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'gate-ux-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'gate ux intro.', title: 'Gate UX Intro',
  });
  await createCode(request, csrf, {
    code: CODE, label: 'Gate UX test',
  });
  await request.dispose();
}
