// visitor-name-welcome.spec.ts -- scans a QR code -> the name picker collects a name (or
// skips) -> the session is issued only once a name choice is made (defer-issue) ->
// ChatRoom welcomes with the name / without one.
//
// User story:
//   1. QR scan -> name picker -> fills in a name -> ChatRoom welcome says
//      "Hi, {firstName}"
//   2. QR scan -> name picker -> skip -> ChatRoom shows a generic greeting

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
      // ChatWelcome greets by first name.
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
