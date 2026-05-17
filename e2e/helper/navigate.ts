// navigate.ts —— page navigation helper（spec 共用）。
//
// eslint 规则把 page.goto 限制在 helper/ 里，让 spec 不在测试体里
// teleport。这里集中所有 goto 调用，spec 用语义化函数 like
// `navigateToHandle(page, 'sijie')`。

import type { Page } from '@playwright/test';

const APP_BASE = process.env['APP_BASE_URL'] ?? 'http://localhost:38127';

// goto —— 任意相对路径（含 query）。eslint 把 page.goto 限制在 helper/ 里。
// caller 给"/setup?t=xxx"、"/login"、"/sijie" 这种。
export async function goto(page: Page, path: string): Promise<void> {
  const url = path.startsWith('/') ? `${APP_BASE}${path}` : `${APP_BASE}/${path}`;
  // eslint-disable-next-line no-restricted-syntax -- helper-only allowed goto
  await page.goto(url);
}

export async function navigateToHandle(page: Page, handle: string): Promise<void> {
  await goto(page, `/${handle}`);
}
