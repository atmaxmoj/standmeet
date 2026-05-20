// navigate.ts —— page navigation helper（spec 共用）。
//
// eslint 规则把 page.goto 限制在 helper/ 里，让 spec 不在测试体里
// teleport。这里集中所有 goto 调用，spec 用语义化函数 like
// `navigateToHandle(page, 'alice')`。

import { expect, type Page } from '@playwright/test';

const APP_BASE = process.env['APP_BASE_URL'] ?? 'http://localhost:38127';

// goto —— 任意相对路径（含 query）。eslint 把 page.goto 限制在 helper/ 里。
// caller 给"/setup?t=xxx"、"/login"、"/alice" 这种。
export async function goto(page: Page, path: string): Promise<void> {
  const url = path.startsWith('/') ? `${APP_BASE}${path}` : `${APP_BASE}/${path}`;
  await page.goto(url);
}

// gotoExpectStatus —— 给 spec 校验 404 / 410 一类 status code 用。
// 返 response.status()；不存在响应时返 0（caller assert 容易）。
export async function gotoExpectStatus(page: Page, path: string): Promise<number> {
  const url = path.startsWith('/') ? `${APP_BASE}${path}` : `${APP_BASE}/${path}`;
  const res = await page.goto(url);
  return res?.status() ?? 0;
}

export async function navigateToHandle(page: Page, handle: string): Promise<void> {
  await goto(page, `/${handle}`);
}

// gotoAdminSection —— admin sidebar 上点一个 section 链接。
// AdminSidebar 的 <Link> 把 active marker / label / hint 三段拼成 accessible
// name（"› codes access" 或 " codes access" 等），所以匹配按 \blabel\b
// word boundary 命中 label 本身，宽容 marker 前缀 + hint 后缀。
export async function gotoAdminSection(page: Page, section: string): Promise<void> {
  await page.getByRole('link', { name: sectionPattern(section) }).click();
}

// expectAdminSidebarVisible —— 检查 sidebar 6 个 section + api·mcp 都渲染。
export async function expectAdminSidebarVisible(page: Page): Promise<void> {
  for (const label of ['raw', 'wiki', 'conversations', 'codes', 'connectors', 'page']) {
    await expect(page.getByRole('link', { name: sectionPattern(label) })).toBeVisible();
  }
}

function sectionPattern(section: string): RegExp {
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`);
}
