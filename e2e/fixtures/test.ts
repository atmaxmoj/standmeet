// test.ts —— 自定义 Playwright test fixture：每个 spec 拿到的 `page` 已经
// 在 `/` 上。这是唯一允许 page.goto 的地方（藏在 fixture 里，spec body
// 看不见 goto，被迫走 UI clicks）。
//
// owner 部署完打开域名 / 就是入口；spec 复刻这个动作。后续所有跳页都
// 走点链接 / 按表单。
//
// 用法：`import { test, expect } from '@/fixtures/test'`。

import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  page: async ({ page }, use) => {
    // Real visitor types the domain in the address bar; Playwright simulates
    // that with one initial navigation. Spec body never touches `goto` —— it
    // walks UI from here on (the app self-redirects to /setup?t=... when
    // unclaimed, or renders the public page when claimed).
    await page.goto('/');
    await use(page);
  },
});

export { expect };
