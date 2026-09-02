// session-persistence.spec.ts —— session restores on refresh + exit returns to long-scroll.
//
// User story:
//   1. code session active → refresh the page → session restores from localStorage → still in ChatRoom
//   2. code session active → click "exit session" → back to long-scroll
//   3. BYOAI → refresh → session restores → still in ChatRoom BYOAI mode
//   4. BYOAI → exit → back to long-scroll

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { goto, enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'persist-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'persistowner',
  fullName: 'Persist Owner',
};

const CODE = 'PERSIST-001';

test.describe('session persistence: refresh + exit', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('code session → refresh → session restored → still in ChatRoom',
    async ({ page }) => {
      await enterCodeSession(page, CODE);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      // refresh
      await goto(page, '/');
      // session should restore from localStorage
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('chat-input')).toBeVisible();
    });

  test('code session → exit → back to long-scroll',
    async ({ page }) => {
      // enterCodeSession already skips the name picker and waits for /sessions 200 — the
      // picker is already consumed, don't dismiss it a second time (that risks landing in
      // its unmount window → click times out at 10s, a check-then-act race).
      await enterCodeSession(page, CODE);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      // click exit
      await page.getByRole('link', { name: 'exit session' }).click();
      // Exit navigates to /gate; session strip should be gone
      await page.waitForURL('**/gate', { timeout: 5_000 });
      await expect(page.getByTestId('session-strip')).toHaveCount(0, { timeout: 5_000 });
    });

  test('BYOAI session → refresh → session restored',
    async ({ page }) => {
      // Navigate to gate and submit BYOAI
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      await page.getByTestId('byoai-provider').selectOption('anthropic');
      await page.getByTestId('byoai-model').fill('claude-haiku-4-5-20251001');
      await page.getByTestId('byoai-key').fill('sk-ant-fake-key-persist');
      await page.getByTestId('byoai-submit').click();
      await page.waitForURL('**/', { timeout: 10_000 });
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      // refresh
      await goto(page, '/');
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('session-strip')).toContainText(/byoai/i);
    });

  test('BYOAI session → exit → back to long-scroll',
    async ({ page }) => {
      // Set up BYOAI session
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      await page.getByTestId('byoai-provider').selectOption('anthropic');
      await page.getByTestId('byoai-model').fill('claude-haiku-4-5-20251001');
      await page.getByTestId('byoai-key').fill('sk-ant-fake-key-persist2');
      await page.getByTestId('byoai-submit').click();
      await page.waitForURL('**/', { timeout: 10_000 });
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      // The BYOAI flow never triggers the name picker (it's code-mode only), so no dismiss is needed.
      // exit navigates to /gate
      await page.getByRole('link', { name: 'exit session' }).click();
      await page.waitForURL('**/gate', { timeout: 5_000 });
      await expect(page.getByTestId('session-strip')).toHaveCount(0, { timeout: 5_000 });
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
  const apiToken = await createAPIToken(request, csrf, 'persist-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'persist owner intro.', title: 'Persist Intro',
  });
  await createCode(request, csrf, {
    code: CODE, label: 'Persist test',
  });
  await request.dispose();
}
