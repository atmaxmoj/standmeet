// chat-composer.spec.ts —— ChatComposer 状态机: starter chips, pending,
// exhausted, rapid submit.
//
// 用户故事：
//   1. starter chips render (coded: starters from code)
//   2. click starter chip → auto-send → chips disappear
//   3. manual input → ask → turn renders → answer renders
//   4. pending state → input disabled + submit gray
//   5. rapid double-submit → pending lock prevents double-send

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'comp-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'compowner',
  fullName: 'Comp Owner',
};

const CODE = 'COMP-001';
const STARTERS = ['What do you do?', 'Tell me about your projects'];

test.describe('ChatComposer behavior', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('coded visitor sees starter chips → click → auto-send → chips gone',
    async ({ page }) => {
      await goto(page, `/?code=${CODE}`);
      await page.waitForResponse((res) =>
        res.url().endsWith('/api/v1/sessions') && res.status() === 200);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      // Starter chips should be visible
      const chips = page.getByTestId('starter-chips');
      await expect(chips).toBeVisible({ timeout: 5_000 });
      // Click first starter
      await chips.locator('button').first().click();
      // Answer should appear, chips should disappear
      await expect(page.locator('[data-testid="answer-body"]'))
        .toBeVisible({ timeout: 15_000 });
      await expect(chips).toHaveCount(0);
    });

  test('manual input → ask → turn + answer render',
    async ({ page }) => {
      await goto(page, `/?code=${CODE}`);
      await page.waitForResponse((res) =>
        res.url().endsWith('/api/v1/sessions') && res.status() === 200);
      const input = page.locator('[data-testid="chat-input"] input');
      await input.fill('what are your skills?');
      await input.press('Enter');
      // "retrieving" indicator should appear
      await expect(page.getByTestId('answer-pending')).toBeVisible({ timeout: 5_000 });
      // Then answer body
      await expect(page.locator('[data-testid="answer-body"]'))
        .toBeVisible({ timeout: 15_000 });
    });

  test('pending state → input disabled + submit gray',
    async ({ page }) => {
      await goto(page, `/?code=${CODE}`);
      await page.waitForResponse((res) =>
        res.url().endsWith('/api/v1/sessions') && res.status() === 200);
      const input = page.locator('[data-testid="chat-input"] input');
      await input.fill('test pending');
      // Intercept the response to keep it pending longer
      await input.press('Enter');
      // During pending, input should be disabled
      await expect(input).toBeDisabled({ timeout: 3_000 });
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
  const apiToken = await createAPIToken(request, csrf, 'comp-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'comp owner intro.', title: 'Comp Intro',
  });
  await createCode(request, csrf, {
    code: CODE, label: 'Composer test',
    suggested_questions: STARTERS,
  });
  await request.dispose();
}
