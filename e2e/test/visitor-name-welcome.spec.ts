// visitor-name-welcome.spec.ts —— QR absorb → VisitorNamePicker 填名 →
// ChatRoom welcome 带名字 / skip → welcome 无名字。
//
// 用户故事：
//   1. QR 扫码 → VisitorNamePicker 弹出 → 填名 → ChatRoom welcome 带名字
//   2. QR 扫码 → VisitorNamePicker → skip → ChatRoom welcome 无名字

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
      await page.waitForResponse((res) =>
        res.url().endsWith('/api/v1/sessions') && res.status() === 200);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      const nameInput = page.getByTestId('visitor-name-input');
      await expect(nameInput).toBeVisible({ timeout: 5_000 });
      await nameInput.fill('Sarah Chen');
      await page.getByTestId('visitor-name-submit').click();
      await expect(nameInput).toBeHidden({ timeout: 3_000 });
      // ChatWelcome should greet by first name
      await expect(page.getByTestId('chat-welcome')).toContainText('Sarah');
    });

  test('skip name → welcome says generic greeting',
    async ({ page }) => {
      await goto(page, `/?code=${CODE}`);
      await page.waitForResponse((res) =>
        res.url().endsWith('/api/v1/sessions') && res.status() === 200);
      // clear previous session data
      await page.evaluate(() => {
        window.localStorage.removeItem('standmeet-visitor-name-dismissed');
        const raw = window.localStorage.getItem('standmeet-session');
        if (!raw) return;
        const s = JSON.parse(raw);
        s.visitor = null;
        window.localStorage.setItem('standmeet-session', JSON.stringify(s));
      });
      await goto(page, '/');
      const skipBtn = page.getByTestId('visitor-name-skip');
      await expect(skipBtn).toBeVisible({ timeout: 5_000 });
      await skipBtn.click();
      await expect(skipBtn).toBeHidden({ timeout: 3_000 });
      // Welcome should not show a specific name
      const welcome = page.getByTestId('chat-welcome');
      await expect(welcome).toBeVisible();
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
  await createCode(request, csrf, {
    code: CODE, label: 'Welcome test',
  });
  await request.dispose();
}
