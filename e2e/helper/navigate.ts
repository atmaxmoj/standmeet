// navigate.ts —— page navigation helper（spec 共用）。
//
// eslint 规则把 page.goto 限制在 helper/ 里，让 spec 不在测试体里
// teleport。这里集中所有 goto 调用，spec 用语义化函数 like
// `navigateToHandle(page, 'sijie')`。

import type { Page } from '@playwright/test';

const APP_BASE = process.env['APP_BASE_URL'] ?? 'http://localhost:38127';

export async function navigateToHandle(page: Page, handle: string): Promise<void> {
  // eslint-disable-next-line no-restricted-syntax -- helper-only allowed goto
  await page.goto(`${APP_BASE}/${handle}`);
}
