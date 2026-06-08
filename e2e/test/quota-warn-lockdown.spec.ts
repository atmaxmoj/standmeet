// quota-warn-lockdown.spec.ts —— quota 到 80% warn + 用尽 lockdown + 无限
//
// 用户故事：
//   1. turns 到 80% → SessionStrip 变 warn + "request more ↗" 出现
//   2. quota 用尽 → composer locked + 友好提示
//   3. max_turns = 0 (无限制) → 永不 lock
//   4. owner 改 quota 值 → 下次 session 生效

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'warn-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'warnowner',
  fullName: 'Warn Owner',
};

const WARN_CODE = 'WARN-005';
const UNLIMITED_CODE = 'UNLIM-001';
const MAX_TURNS = 5;

test.describe('quota warn at 80% + lockdown + unlimited', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('turns at 80% → strip shows warn state + request more link',
    async ({ page }) => {
      await enterCodeSession(page, WARN_CODE);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      // Send 4 of 5 turns (80%)
      for (let i = 0; i < 4; i++) {
        const input = page.locator('[data-testid="chat-input-field"]');
        await input.fill(`turn ${i + 1}`);
        await input.press('Enter');
        await expect(page.locator('[data-testid="answer-body"]').nth(i))
          .toBeVisible({ timeout: 15_000 });
      }
      // Strip should show warn state
      const strip = page.getByTestId('session-strip');
      await expect(strip).toHaveAttribute('data-warn', 'true');
      await expect(page.getByText('request more')).toBeVisible();
    });

  test('quota exhausted → composer locked + session full message',
    async ({ page }) => {
      await enterCodeSession(page, WARN_CODE);
      // Use all 5 turns
      for (let i = 0; i < MAX_TURNS; i++) {
        const input = page.locator('[data-testid="chat-input-field"]');
        await input.fill(`exhaust turn ${i + 1}`);
        await input.press('Enter');
        await expect(page.locator('[data-testid="answer-body"]').nth(i))
          .toBeVisible({ timeout: 15_000 });
      }
      // Composer should be locked
      const input = page.locator('[data-testid="chat-input-field"]');
      await expect(input).toBeDisabled();
      await expect(page.getByText('session full')).toBeVisible();
    });

  test('max_turns = null (unlimited) → never locks',
    async ({ page }) => {
      await enterCodeSession(page, UNLIMITED_CODE);
      // Send a few turns and verify never locked
      for (let i = 0; i < 3; i++) {
        const input = page.locator('[data-testid="chat-input-field"]');
        await input.fill(`unlimited turn ${i + 1}`);
        await input.press('Enter');
        await expect(page.locator('[data-testid="answer-body"]').nth(i))
          .toBeVisible({ timeout: 15_000 });
      }
      // Composer still active
      const input = page.locator('[data-testid="chat-input-field"]');
      await expect(input).toBeEnabled();
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
  const apiToken = await createAPIToken(request, csrf, 'warn-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'warn owner intro.', title: 'Warn Intro',
  });
  await createCode(request, csrf, {
    code: WARN_CODE, label: 'Warn test', max_turns_per_session: MAX_TURNS,
  });
  await createCode(request, csrf, {
    code: UNLIMITED_CODE, label: 'Unlimited test',
    max_turns_per_session: null,
  });
  await request.dispose();
}
