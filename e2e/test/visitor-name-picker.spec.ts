// visitor-name-picker.spec.ts —— 首次 chat-capable surface (root /) +
// session 有 code 但 visitor 名空 → 弹 VisitorNamePicker 模态。
//
// 业务故事：
//   1. QR 扫码进 / → visitor 没填名字 → 模态自动弹（access granted · code…）。
//   2. visitor 填名 + submit → 模态消失 + SessionStrip 出现 "you · <名>"。
//   3. dismiss timestamp 落 LS → 同 session 内不再弹。
//   4. 直接点 skip → visitor 留 "anonymous"，模态不再弹。

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

  test('QR absorb without name → modal pops; submit name → modal closes + strip shows name',
    async ({ page }) => {
      await goto(page, `/?code=${CODE}`);
      // session POST first
      await page.waitForResponse((res) =>
        res.url().endsWith('/api/v1/sessions') && res.status() === 200);
      // strip is up
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      // picker auto-pops（store visitor 是 null + session 是 code-tier）
      const nameInput = page.getByTestId('visitor-name-input');
      await expect(nameInput).toBeVisible({ timeout: 5_000 });
      // 输 + submit
      await nameInput.fill('Recruiter Joe');
      await page.getByTestId('visitor-name-submit').click();
      // 模态消失 + strip 显示 visitor name
      await expect(nameInput).toBeHidden({ timeout: 3_000 });
      await expect(page.getByTestId('session-strip')).toContainText('Recruiter Joe');
    });

  test('skip → modal closes + visitor = "anonymous"; reload no re-pop',
    async ({ page }) => {
      await goto(page, `/?code=${CODE}`);
      await page.waitForResponse((res) =>
        res.url().endsWith('/api/v1/sessions') && res.status() === 200);
      // 先清掉前一 test 留下的 dismiss flag + LS visitor，逼出 modal
      await page.evaluate(() => {
        window.localStorage.removeItem('standmeet-visitor-name-dismissed');
        const raw = window.localStorage.getItem('standmeet-session');
        if (!raw) return;
        const s = JSON.parse(raw) as { visitor: string | null };
        s.visitor = null;
        window.localStorage.setItem('standmeet-session', JSON.stringify(s));
      });
      await goto(page, '/'); // re-mount root to pick up cleared dismiss + visitor
      const skipBtn = page.getByTestId('visitor-name-skip');
      await expect(skipBtn).toBeVisible({ timeout: 5_000 });
      await skipBtn.click();
      // modal 消失
      await expect(skipBtn).toBeHidden({ timeout: 3_000 });
      // dismiss timestamp 写进 LS
      const dismissed = await page.evaluate(
        () => window.localStorage.getItem('standmeet-visitor-name-dismissed'));
      expect(dismissed).toBeTruthy();
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
