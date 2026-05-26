// test.ts —— 自定义 Playwright test fixture：包两种入口 page。
//
//   `page`       —— 落根 /。模拟"访客（或 owner 自己）打开域名"。pre-claim
//                  时 server 自动 redirect 到 /setup?t=...；claimed 时渲染
//                  公开页。
//   `adminPage`  —— 落 /admin/page（已登录）。模拟"owner 直接输 /admin /
//                  从书签点进"。spec 假设：beforeAll 已经走 API claim。
//                  fixture 自身处理 redirect-to-login → 填表单 → /admin/page。
//
// 这两个是 e2e 里**仅有的两处 page.goto**。spec body 一律走 UI clicks
// (footer 链接 / sidebar / 表单按钮)，不允许出现 goto。
//
// 用法：
//   import { test, expect } from '@/fixtures/test';
//   test('...', async ({ page }) => { ... });        // 访客视角
//   test('...', async ({ adminPage }) => { ... });   // 已登录 admin 视角

import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const OWNER_EMAIL = 'alice@example.com';
const OWNER_PASSWORD = 'correct-horse-battery-staple';

type Fixtures = {
  adminPage: Page;
};

export const test = base.extend<Fixtures>({
  page: async ({ page }, use) => {
    await page.goto('/');
    await use(page);
  },
  // adminPage 不通过 footer link 进 admin —— footer 的 admin link 已经从
  // 公开页删了（admin 入口对访客不可见）。fixture 模拟"owner 输 /admin
  // 直接进"，未授权时被 AdminShell 弹 /login，填表单后回 /admin/page。
  //
  // 等待用 race：等 login form 或 admin sidebar 任一可见，避免 URL 转场
  // (/admin → /admin/page → /login) 中间态被 waitForURL 提前匹配。
  adminPage: async ({ page }, use) => {
    await page.goto('/admin');
    const loginEmail = page.getByTestId('email');
    // sidebar 'page' nav 出现 = 已登录。data-testid 跟 design label 改名解耦。
    const adminSidebar = page.getByTestId('admin-nav-page');
    await Promise.race([
      loginEmail.waitFor({ state: 'visible', timeout: 10_000 }),
      adminSidebar.waitFor({ state: 'visible', timeout: 10_000 }),
    ]);
    if (await loginEmail.isVisible()) {
      await loginEmail.fill(OWNER_EMAIL);
      await page.getByTestId('password').fill(OWNER_PASSWORD);
      await page.getByTestId('submit').click();
      await adminSidebar.waitFor({ state: 'visible', timeout: 10_000 });
    }
    await use(page);
  },
});

export { expect };
