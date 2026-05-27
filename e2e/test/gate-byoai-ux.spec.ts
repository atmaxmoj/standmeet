// gate-byoai-ux.spec.ts —— gate BYOAI panel UX: missing fields, provider switch.
//
// 用户故事：
//   1. 缺必填字段 → submit disabled
//   2. provider 切换 → endpoint/model placeholder 变

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
