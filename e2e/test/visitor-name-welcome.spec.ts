// visitor-name-welcome.spec.ts —— 扫码 → 名字选择器填名(或 skip)→ 选名字
// 时才 issue session(defer-issue)→ ChatRoom welcome 带名字 / 无名字。
//
// 用户故事：
//   1. QR 扫码 → 名字选择器 → 填名 → ChatRoom welcome "Hi, {firstName}"
//   2. QR 扫码 → 名字选择器 → skip → ChatRoom welcome 通用问候

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'welcome-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'welcomeowner',
  fullName: 'Welcome Owner',
};

const CODE = 'WELCOME-001';

test.describe('visitor name → ChatRoom welcome greeting', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('fill name → welcome says "Hi, {firstName}"',
    async ({ page }) => {
      await goto(page, `/?code=${CODE}`);
      const nameInput = page.getByTestId('visitor-name-input');
      await expect(nameInput).toBeVisible({ timeout: 5_000 });
      await nameInput.fill('Sarah Chen');
      await page.getByTestId('visitor-name-submit').click();
      await expect(nameInput).toBeHidden({ timeout: 5_000 });
      // ChatWelcome 按 first name 问候。
      await expect(page.getByTestId('chat-welcome')).toContainText('Sarah', { timeout: 10_000 });
    });

  test('skip name → welcome says generic greeting',
    async ({ page }) => {
      await goto(page, `/?code=${CODE}`);
      const skipBtn = page.getByTestId('visitor-name-skip');
      await expect(skipBtn).toBeVisible({ timeout: 5_000 });
      await skipBtn.click();
      await expect(skipBtn).toBeHidden({ timeout: 5_000 });
      const welcome = page.getByTestId('chat-welcome');
      await expect(welcome).toBeVisible({ timeout: 10_000 });
      await expect(welcome).not.toContainText('Sarah');
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
  const apiToken = await createAPIToken(request, csrf, 'welcome-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'welcome owner intro.', title: 'Welcome Intro',
  });
  await createCode(request, csrf, { code: CODE, label: 'Welcome test' });
  await request.dispose();
}
