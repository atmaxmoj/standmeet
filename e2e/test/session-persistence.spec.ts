// session-persistence.spec.ts —— session 刷新恢复 + exit 回到 long-scroll。
//
// 用户故事：
//   1. code session active → 刷新页面 → session 从 localStorage 恢复 → 仍在 ChatRoom
//   2. code session active → 点 "exit session" → 回到 long-scroll
//   3. BYOAI → 刷新 → session 恢复 → 仍在 ChatRoom BYOAI mode
//   4. BYOAI → exit → 回到 long-scroll

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

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
      await goto(page, `/?code=${CODE}`);
      await page.waitForResponse((res) =>
        res.url().endsWith('/api/v1/sessions') && res.status() === 200);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      // refresh
      await goto(page, '/');
      // session should restore from localStorage
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('chat-input')).toBeVisible();
    });

  test('code session → exit → back to long-scroll',
    async ({ page }) => {
      await goto(page, `/?code=${CODE}`);
      await page.waitForResponse((res) =>
        res.url().endsWith('/api/v1/sessions') && res.status() === 200);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      // click exit
      await page.getByTestId('session-strip-exit').click();
      // strip gone, long-scroll sections visible
      await expect(page.getByTestId('session-strip')).toHaveCount(0, { timeout: 5_000 });
      await expect(page.getByText('Persist Owner')).toBeVisible();
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
      // exit
      await page.getByTestId('session-strip-exit').click();
      await expect(page.getByTestId('session-strip')).toHaveCount(0, { timeout: 5_000 });
      await expect(page.getByText('Persist Owner')).toBeVisible();
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
