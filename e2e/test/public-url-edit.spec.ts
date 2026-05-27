// public-url-edit.spec.ts —— owner 在 /admin/page · site 块编辑 public URL，
// /me 即刻吐回新值；下一次发的 application QR 就用新 URL。
//
// 用户故事：
//   owner 一开始用 http://localhost:38127 部署，过段时间挂上自己的域名
//   https://alice.dev。打开 admin · page · site，点 public URL 那行的
//   change，填新 URL，保存。/me 返新值；前端 sessionStore mutate 后 display
//   行刷成新的。后续 application.commit 生成的 PDF QR 也指向新 URL。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
  // claim helper 默认 http://localhost:38127；这里显式写一遍便于断言。
  initialPublicURL: 'http://localhost:38127',
};

const NEW_PUBLIC_URL = 'https://alice.dev';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('owner edits public URL post-claim', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
      publicUrl: OWNER.initialPublicURL,
    });
    await request.dispose();
  });

  test('change public URL via site block; display row shows new value',
    async ({ adminPage: page }) => {
      await expect(page.getByTestId('public-url-display')).toBeVisible();
      // 初始值就是 claim 时填的。
      await expect(page.getByTestId('public-url-display'))
        .toContainText(OWNER.initialPublicURL);

      await openEditor(page);
      await fillNewURL(page, NEW_PUBLIC_URL);
      await saveAndExpectDisplay(page, NEW_PUBLIC_URL);
    });

  test('invalid URL is rejected with inline hint',
    async ({ adminPage: page }) => {
      await openEditor(page);
      await page.getByTestId('public-url-input').fill('not-a-url');
      // hint 出现 "must start with http(s)"；save 按钮 disabled
      await expect(page.getByTestId('public-url-hint'))
        .toContainText(/http/);
      await expect(page.getByTestId('public-url-save-btn')).toBeDisabled();
    });
});

async function openEditor(page: Page): Promise<void> {
  await page.getByTestId('public-url-change-btn').click();
  await expect(page.getByTestId('public-url-editor')).toBeVisible();
}

async function fillNewURL(page: Page, url: string): Promise<void> {
  await page.getByTestId('public-url-input').fill(url);
  await expect(page.getByTestId('public-url-save-btn')).toBeEnabled();
}

async function saveAndExpectDisplay(page: Page, url: string): Promise<void> {
  await page.getByTestId('public-url-save-btn').click();
  // editor closes → display row reappears with new URL.
  await expect(page.getByTestId('public-url-display'))
    .toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('public-url-display')).toContainText(url);
}
