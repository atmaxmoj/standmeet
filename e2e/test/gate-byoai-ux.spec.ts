// gate-byoai-ux.spec.ts —— gate BYOAI panel UX: missing fields, provider switch.
//
// 用户故事：
//   1. 缺必填字段 → submit disabled
//   2. provider 切换 → endpoint/model placeholder 变
//   3. 没填 key → "load models" 禁用(拉不了 model list);填了 key → 启用

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const OWNER = {
  email: 'gate-byoai@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'gatebyoai',
  fullName: 'Gate BYOAI Owner',
};

test.describe('gate BYOAI panel UX', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('missing required fields → submit disabled',
    async ({ page }) => {
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      // Only fill provider, not key or model
      await page.getByTestId('byoai-provider').selectOption('anthropic');
      await expect(page.getByTestId('byoai-submit')).toBeDisabled();
    });

  test('key + model fields resist password-manager autofill (UX-8)',
    async ({ page }) => {
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      // A password-type key field trips the browser's login-form heuristic → it autofills a
      // saved email into `model` and a saved password into `key` (real-env UX-8). `new-password`
      // on the key breaks that heuristic; `off` on the model keeps the email out.
      await expect(page.getByTestId('byoai-key')).toHaveAttribute('autocomplete', 'new-password');
      await expect(page.getByTestId('byoai-model')).toHaveAttribute('autocomplete', 'off');
    });

  test('provider switch → key placeholder text changes',
    async ({ page }) => {
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      // Select anthropic
      await page.getByTestId('byoai-provider').selectOption('anthropic');
      const keyInput = page.getByTestId('byoai-key');
      const anthropicPlaceholder = await keyInput.getAttribute('placeholder');
      // Switch to openai
      await page.getByTestId('byoai-provider').selectOption('openai');
      const openaiPlaceholder = await keyInput.getAttribute('placeholder');
      // Key placeholders should differ per provider
      expect(anthropicPlaceholder).not.toBe(openaiPlaceholder);
    });

  test('load models disabled until a key is entered',
    async ({ page }) => {
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      await page.getByTestId('byoai-provider').selectOption('anthropic');
      const loadBtn = page.getByTestId('byoai-load-models');
      await expect(loadBtn).toBeDisabled();
      await page.getByTestId('byoai-key').fill('sk-ant-test-key');
      await expect(loadBtn).toBeEnabled();
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
