// visitor-name-picker.spec.ts —— 扫码(pending code)→ 弹 VisitorNamePicker
// 模态;defer-issue:模态就是 issue 点,填名/skip 才开 session。
//
// 业务故事：
//   1. QR 扫码进 / → 模态自动弹（access granted · code…）。
//   2. visitor 填名 + submit → 开 session + 模态消失 + SessionStrip 显名字。
//   3. skip → 匿名开 session,模态消失;reload(pending 已消费 + session 在)不再弹。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'name-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'nameowner',
  fullName: 'Name Owner',
};

const CODE = 'NAME-001';

test.describe('VisitorNamePicker · auto-pop on first chat + persist', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwnerWithCode(playwright);
  });

  test('QR absorb → modal pops; submit name → session + strip shows name',
    async ({ page }) => {
      await goto(page, `/?code=${CODE}`);
      // 模态自动弹(有 pending code)。
      const nameInput = page.getByTestId('visitor-name-input');
      await expect(nameInput).toBeVisible({ timeout: 5_000 });
      // 输 + submit → 开 session + 模态消失 + strip 显名字。
      await nameInput.fill('Recruiter Joe');
      await page.getByTestId('visitor-name-submit').click();
      await expect(nameInput).toBeHidden({ timeout: 5_000 });
      await expect(page.getByTestId('session-strip')).toContainText('Recruiter Joe', {
        timeout: 10_000,
      });
    });

  test('skip → anonymous session, modal closes; reload does not re-pop',
    async ({ page }) => {
      await goto(page, `/?code=${CODE}`);
      const skipBtn = page.getByTestId('visitor-name-skip');
      await expect(skipBtn).toBeVisible({ timeout: 5_000 });
      await skipBtn.click();
      // 模态消失 + 匿名 session 起来(strip 在)。
      await expect(skipBtn).toBeHidden({ timeout: 5_000 });
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 10_000 });
      // reload:pending 已消费 + session 已落 LS → 不再弹模态。
      await goto(page, '/');
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('visitor-name-skip')).toBeHidden();
    });

  // F-A-5 — re-opening the SAME ?code= link while already in a named session must
  // NOT re-pop the identity picker over the active session.
  test('re-entry with the same code does not re-pop the picker over an active session',
    async ({ page }) => {
      // Establish a named session for CODE.
      await goto(page, `/?code=${CODE}`);
      const nameInput = page.getByTestId('visitor-name-input');
      await expect(nameInput).toBeVisible({ timeout: 5_000 });
      await nameInput.fill('Recruiter Joe');
      await page.getByTestId('visitor-name-submit').click();
      await expect(nameInput).toBeHidden({ timeout: 5_000 });
      await expect(page.getByTestId('session-strip')).toContainText('Recruiter Joe', {
        timeout: 10_000,
      });
      // Recruiter re-scans / re-opens the same code link — already resolved.
      await goto(page, `/?code=${CODE}`);
      // Strip still shows the same identity; the picker does NOT re-appear.
      await expect(page.getByTestId('session-strip')).toContainText('Recruiter Joe', {
        timeout: 10_000,
      });
      await expect(page.getByTestId('visitor-name-overlay')).toBeHidden();
    });
});

async function initOwnerWithCode(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await seedCode(request);
  await request.dispose();
}

async function seedCode(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'name-seed-token');
  await initMCP(request, apiToken);
  await createCode(request, csrf, {
    code: CODE,
    label: 'Visitor name picker test',
  });
}
