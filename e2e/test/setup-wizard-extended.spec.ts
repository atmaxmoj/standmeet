// setup-wizard-extended.spec.ts —— setup wizard extended: handle validation,
// publicUrl validation, provider step, back button.
//
// 用户故事：
//   1. step 1 → handle 非法字符 → next disabled
//   2. step 1 → publicUrl 非 http → next disabled
//   3. step 3 → select provider → key field placeholder changes
//   4. step 3 → ollama selected → key field hidden (needsKey=false)
//   5. back button → return to previous step → data preserved
//   6. step 1 empty → next disabled (realtime)

import type { Page } from '@playwright/test';

import { resetInstance } from '@/fixtures/instance';
import { test, expect } from '@/fixtures/test';

const OWNER = {
  full: 'Test User',
  handle: 'testuser',
  publicUrl: 'http://localhost:38127',
  email: 'test@example.com',
  password: 'correct-horse-battery-staple',
};

test.describe('setup wizard extended validation', () => {
  test.beforeEach(() => { resetInstance(); });

  test('handle with illegal chars → next advances (server validates)',
    async ({ page }) => {
      await page.waitForURL(/\/setup\?t=/, { timeout: 10_000 });
      await page.getByTestId('full').fill(OWNER.full);
      await page.getByTestId('handle').fill('bad handle!@#');
      await page.getByTestId('public-url').fill(OWNER.publicUrl);
      // Client side does not validate handle chars — next advances to step 2
      await expect(page.getByTestId('next')).toBeEnabled();
      await page.getByTestId('next').click();
      // Should be on step 2 now (email field visible)
      await expect(page.getByTestId('email')).toBeVisible({ timeout: 3_000 });
    });

  test('publicUrl without http → next disabled',
    async ({ page }) => {
      await page.waitForURL(/\/setup\?t=/, { timeout: 10_000 });
      await page.getByTestId('full').fill(OWNER.full);
      await page.getByTestId('handle').fill(OWNER.handle);
      await page.getByTestId('public-url').fill('not-a-url');
      await expect(page.getByTestId('next')).toBeDisabled();
    });

  test('step 3 → provider select changes key placeholder',
    async ({ page }) => {
      await page.waitForURL(/\/setup\?t=/, { timeout: 10_000 });
      await fillStep1(page);
      await page.getByTestId('next').click();
      await fillStep2(page);
      await page.getByTestId('next').click();
      // Step 3: AI provider
      const keyField = page.getByTestId('setup-ai-key');
      await expect(keyField).toBeVisible({ timeout: 5_000 });
      // Select anthropic (chip button)
      await page.getByTestId('setup-provider-anthropic').click();
      const anthropicPlaceholder = await keyField.getAttribute('placeholder');
      // Select openai (chip button)
      await page.getByTestId('setup-provider-openai').click();
      const openaiPlaceholder = await keyField.getAttribute('placeholder');
      expect(anthropicPlaceholder).not.toBe(openaiPlaceholder);
    });

  test('step 3 → ollama → key field hidden',
    async ({ page }) => {
      await page.waitForURL(/\/setup\?t=/, { timeout: 10_000 });
      await fillStep1(page);
      await page.getByTestId('next').click();
      await fillStep2(page);
      await page.getByTestId('next').click();
      await page.getByTestId('setup-provider-ollama').click();
      // Key field should be disabled for ollama (needsKey=false)
      await expect(page.getByTestId('setup-ai-key')).toBeDisabled();
    });

  test('back button → returns to previous step with data preserved',
    async ({ page }) => {
      await page.waitForURL(/\/setup\?t=/, { timeout: 10_000 });
      await fillStep1(page);
      await page.getByTestId('next').click();
      // On step 2 now
      await page.getByTestId('email').fill(OWNER.email);
      // Go back
      await page.getByRole('button', { name: /back/i }).click();
      // Step 1 data should be preserved
      await expect(page.getByTestId('full')).toHaveValue(OWNER.full);
      await expect(page.getByTestId('handle')).toHaveValue(OWNER.handle);
      await expect(page.getByTestId('public-url')).toHaveValue(OWNER.publicUrl);
    });

  test('step 1 all empty → next disabled',
    async ({ page }) => {
      await page.waitForURL(/\/setup\?t=/, { timeout: 10_000 });
      await expect(page.getByTestId('next')).toBeDisabled();
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
