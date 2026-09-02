// quota-warn-lockdown.spec.ts — quota reaching 80% warns + running out locks down +
// unlimited
//
// User story:
//   1. turns reach 80% → SessionStrip switches to warn + "request more ↗" appears
//   2. quota runs out → composer locked + a friendly message
//   3. max_turns = 0 (unlimited) → never locks
//   4. owner changes the quota value → takes effect on the next session

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
      // A bare label says "stopped"; a sentence says **which limit, and who to ask
      // for more**. With only a label, all a visitor learns is that they're blocked
      // — but this code was issued by the owner on purpose, and extending the quota
      // a bit is only a one-line ask.
      const line = page.getByTestId('limit-reached');
      await expect(line).toBeVisible();
      await expect(line, '要说清是哪一种上限').toContainText(/turn limit/i);
      await expect(line, '要指名道姓，不能只说 “the owner”').toContainText(OWNER.handle);
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
