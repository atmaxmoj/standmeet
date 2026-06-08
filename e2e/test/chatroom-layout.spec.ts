// chatroom-layout.spec.ts —— ChatRoom 与 long-scroll 切换。
//
// 用户故事：
//   1. public visitor (no session) → long-scroll (Hero + Insights + Projects + Where + Contact)
//   2. coded visitor → ChatRoom (slim header + welcome + composer) — 不看到 long-scroll
//   3. BYOAI visitor → ChatRoom (BYOAI mode welcome)
//   4. long-scroll visitor 提问后 → ConversationDeck 出现

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'layout-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'layoutowner',
  fullName: 'Layout Owner',
};

const CODE = 'LAYOUT-001';

test.describe('ChatRoom layout switching', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('public visitor sees long-scroll sections',
    async ({ page }) => {
      await expect(page.getByText('Layout Owner')).toBeVisible();
      await expect(page.getByText("things I've been thinking about")).toBeVisible();
      await expect(page.getByText("what I'm building")).toBeVisible();
      await expect(page.getByTestId('chat-input')).toBeVisible();
    });

  test('coded visitor sees ChatRoom, not long-scroll',
    async ({ page }) => {
      await enterCodeSession(page, CODE);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('chat-input')).toBeVisible();
      await expect(page.getByTestId('chat-welcome')).toBeVisible();
    });

  test('BYOAI visitor sees ChatRoom with BYOAI welcome',
    async ({ page }) => {
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      await page.getByTestId('byoai-provider').selectOption('anthropic');
      await page.getByTestId('byoai-model').fill('claude-haiku-4-5-20251001');
      await page.getByTestId('byoai-key').fill('sk-ant-fake-layout');
      await page.getByTestId('byoai-submit').click();
      await page.waitForURL('**/', { timeout: 10_000 });
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('chat-welcome')).toBeVisible();
      await expect(page.getByTestId('chat-welcome')).toContainText(/public/i);
    });

  test('public visitor asks question → ConversationDeck appears',
    async ({ page }) => {
      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill('tell me about yourself');
      await input.press('Enter');
      await expect(page.locator('[data-testid="answer-body"]'))
        .toBeVisible({ timeout: 15_000 });
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
  const apiToken = await createAPIToken(request, csrf, 'layout-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'layout owner intro.', title: 'Layout Intro',
  });
  await createCode(request, csrf, {
    code: CODE, label: 'Layout test',
  });
  await request.dispose();
}
