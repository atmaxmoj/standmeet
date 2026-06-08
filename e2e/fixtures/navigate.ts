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

// enterCodeSession —— 走 `?code=` 入口拿到一个 code session。
//
// defer-issue 后 /sessions 不在扫码时发,而是在名字选择器**选名字(或 skip)**
// 时才发。所以入口序列固定:goto → 名字选择器出现 → 填名提交(或 skip)→ 等
// /sessions 200。name 给字符串 = 用该名字(具名 member);省略 = skip(匿名)。
export async function enterCodeSession(
  page: Page, code: string, name?: string,
): Promise<void> {
  await goto(page, `/?code=${code}`);
  const session = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200,
    { timeout: 15_000 },
  );
  await submitVisitorName(page, name);
  await session;
}

// submitVisitorName —— 名字选择器:有名字就填+提交,没名字就 skip。
async function submitVisitorName(page: Page, name?: string): Promise<void> {
  const skip = page.getByTestId('visitor-name-skip');
  await skip.waitFor({ state: 'visible', timeout: 15_000 });
  if (name === undefined || name === '') {
    await skip.click();
    return;
  }
  await page.getByTestId('visitor-name-input').fill(name);
  await page.getByTestId('visitor-name-submit').click();
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
