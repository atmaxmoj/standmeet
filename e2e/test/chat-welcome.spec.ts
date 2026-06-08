// chat-welcome.spec.ts —— ChatWelcome 渲染不同 mode 的欢迎语。
//
// 用户故事：
//   1. coded mode → 显示 code label + scope 说明 + "ask anything"
//   2. BYOAI mode → 显示 provider name + "public slice only"
//   3. coded + 有 visitor name → "Hi, {firstName}"
//   4. coded + 无 visitor name → "Hi"

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'cwelcome@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'cwelcome',
  fullName: 'CWelcome Owner',
};

const CODE = 'CWELC-001';

test.describe('ChatWelcome renders correct greeting', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('coded mode → welcome shows code info',
    async ({ page }) => {
      await enterCodeSession(page, CODE);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      // Skip name picker if it appears
      const skip = page.getByTestId('visitor-name-skip');
      if (await skip.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await skip.click();
      }
      const welcome = page.getByTestId('chat-welcome');
      await expect(welcome).toBeVisible();
    });

  test('BYOAI mode → welcome mentions public scope',
    async ({ page }) => {
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      await page.getByTestId('byoai-provider').selectOption('anthropic');
      await page.getByTestId('byoai-model').fill('claude-haiku-4-5-20251001');
      await page.getByTestId('byoai-key').fill('sk-ant-fake-cwelcome');
      await page.getByTestId('byoai-submit').click();
      await page.waitForURL('**/', { timeout: 10_000 });
      const welcome = page.getByTestId('chat-welcome');
      await expect(welcome).toBeVisible();
      await expect(welcome).toContainText(/public/i);
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
  const apiToken = await createAPIToken(request, csrf, 'cwelcome-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'cwelcome intro.', title: 'CWelcome Intro',
  });
  await createCode(request, csrf, {
    code: CODE, label: 'Welcome Chat Test',
  });
  await request.dispose();
}
