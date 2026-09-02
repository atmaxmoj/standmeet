// cross-tab-sync.spec.ts — cross-tab sync via localStorage storage events.
//
// User story:
//   1. Tab A logs in with a code → Tab B gets a storage event → SessionStrip appears
//      in sync
//   2. Tab A exits its session → Tab B's SessionStrip disappears

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { enterCodeSession, goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'tab-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'tabowner',
  fullName: 'Tab Owner',
};

const CODE = 'TAB-001';

test.describe('cross-tab session sync via localStorage', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('Tab A absorbs code → Tab B sees SessionStrip appear',
    async ({ browser }) => {
      const context = await browser.newContext();
      const tabA = await context.newPage();
      const tabB = await context.newPage();

      // Tab B starts at /
      await goto(tabB, '/');
      await expect(tabB.getByTestId('session-strip')).toHaveCount(0);

      // Tab A scans the code + picks a name (defer-issue:skip is what actually issues
      // the session).
      await enterCodeSession(tabA, CODE);
      await expect(tabA.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });

      // Tab B should pick up the storage event and show strip
      await expect(tabB.getByTestId('session-strip')).toBeVisible({ timeout: 10_000 });

      await context.close();
    });

  test('Tab A exits session → Tab B SessionStrip disappears',
    async ({ browser }) => {
      const context = await browser.newContext();
      const tabA = await context.newPage();
      const tabB = await context.newPage();

      // Tab A scans the code + picks a name to get in.
      await enterCodeSession(tabA, CODE);
      await expect(tabA.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });

      await goto(tabB, '/');
      await expect(tabB.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });

      // Tab A exits → navigates to /gate → clears localStorage
      await tabA.getByRole('link', { name: 'exit session' }).click();
      await tabA.waitForURL('**/gate', { timeout: 5_000 });

      // Tab B should also lose strip
      await expect(tabB.getByTestId('session-strip')).toHaveCount(0, { timeout: 10_000 });

      await context.close();
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
  const apiToken = await createAPIToken(request, csrf, 'tab-seed');
  await initMCP(request, apiToken);
  await createCode(request, csrf, {
    code: CODE, label: 'Cross-tab test',
  });
  await request.dispose();
}
