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
      loginEmail.waitFor({ state: 'visible', timeout: 10_000 }),
      adminSidebar.waitFor({ state: 'visible', timeout: 10_000 }),
    ]);
    if (await loginEmail.isVisible()) {
      await loginEmail.fill(ownerCredentials.email);
      await page.getByTestId('password').fill(ownerCredentials.password);
      await page.getByTestId('submit').click();
      await adminSidebar.waitFor({ state: 'visible', timeout: 10_000 });
    }
    await use(page);
  },
});

export { expect };
