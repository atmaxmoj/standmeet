// navigate.ts —— page navigation helper（spec 共用）。
//
// eslint 规则把 page.goto 限制在 helper/ 里，让 spec 不在测试体里
// teleport。这里集中所有 goto 调用，spec 用语义化函数。
//
// v1 单 owner instance —— 公开页直接挂根 /，URL 不带 handle。

import { expect, type Page } from '@playwright/test';

const APP_BASE = process.env['APP_BASE_URL'] ?? 'http://localhost:38127';

// goto —— 任意相对路径（含 query）。eslint 把 page.goto 限制在 helper/ 里。
// caller 给"/setup?t=xxx"、"/login"、"/alice" 这种。
export async function goto(page: Page, path: string): Promise<void> {
  const url = path.startsWith('/') ? `${APP_BASE}${path}` : `${APP_BASE}/${path}`;
  await page.goto(url);
}

// gotoAdminSection —— admin sidebar 上点一个 section 的 nav link。
// 按 testid (data-testid="admin-nav-<slug>") 匹配，不受 design 改 label
// / sidebar 重排 影响。
export async function gotoAdminSection(page: Page, slug: string): Promise<void> {
  await page.getByTestId(`admin-nav-${slug}`).click();
}

// expectAdminSidebarVisible —— 'page' nav 链接可见即视为 sidebar healthy。
export async function expectAdminSidebarVisible(page: Page): Promise<void> {
  await expect(page.getByTestId('admin-nav-page')).toBeVisible();
}
