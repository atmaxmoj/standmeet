// test.ts —— 自定义 Playwright test fixture。
//
//   `page`       —— 落根 /。访客视角。
//   `adminPage`  —— 落 /admin，自动登录。owner 视角。
//
// adminPage 的登录凭据从 `ownerCredentials` fixture 读 —— 每个 test file
// 通过 test.use({ ownerCredentials: { email, password } }) 设自己的凭据。
// 不设的话 fallback 到 alice@example.com（向后兼容老 spec）。
//
// 隔离模型：每个 test file 用不同 email claim instance，adminPage fixture
// 用该 file 的 credentials 登录。Playwright 1 worker 串行跑，每个 file
// 的 beforeAll 做 resetInstance + claim。

import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// Playwright 1.60 不再 named-export `Playwright` 类型；spec 文件里很
// 多老地方写 `playwright: Playwright`，全改 80+ 处 import 路径不值得。
// 这里 module augmentation 把 alias 加回去 —— 直接从 PlaywrightWorker
// Args.playwright 取，避免依赖 `typeof import('playwright-core')` 字面
// 解析（外层 node_modules 撞了个老 copy，会让 tsc 在不同位置看到不
// 同的 type identity）。
declare module '@playwright/test' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  export type Playwright = import('@playwright/test').PlaywrightWorkerArgs['playwright'];
}

interface OwnerCredentials {
  email: string;
  password: string;
}

const DEFAULT_CREDENTIALS: OwnerCredentials = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
};

type Fixtures = {
  ownerCredentials: OwnerCredentials;
  adminPage: Page;
};

export const test = base.extend<Fixtures>({
  ownerCredentials: [DEFAULT_CREDENTIALS, { option: true }],

  page: async ({ page }, use) => {
    await page.goto('/');
    await use(page);
  },

  adminPage: async ({ page, ownerCredentials }, use) => {
    await page.goto('/admin');
    const loginEmail = page.getByTestId('email');
    const adminSidebar = page.getByTestId('admin-nav-page');
    await Promise.race([
      loginEmail.waitFor({ state: 'visible', timeout: 15_000 }),
      adminSidebar.waitFor({ state: 'visible', timeout: 15_000 }),
    ]);
    if (await loginEmail.isVisible()) {
      await loginEmail.fill(ownerCredentials.email);
      await page.getByTestId('password').fill(ownerCredentials.password);
      await page.getByTestId('submit').click();
      // sweep 模式下 372 spec 串跑、admin login + 首屏渲染会被资源压力
      // 拖到 10s 之外；超出 actionTimeout=10s 默认会零星 flake (sweep
      // 跑了几次 admin-wiki-crud / admin-seo 都被这条踩过)。30s 留余量。
      await adminSidebar.waitFor({ state: 'visible', timeout: 30_000 });
    }
    await use(page);
  },
});

export { expect };
export type { Page, APIRequestContext, Browser } from '@playwright/test';
