// corpus-crud-ui.spec.ts —— raw / wiki / output 三层 CRUD UI 走通。
//
// 用户故事：
//   owner 不开 Claude Desktop，直接在 admin 网页里：
//     1. /admin/wiki 点 "+ new wiki" → 填表单 → 保存 → list 里看到
//     2. 点同一条 wiki 的 "promote → output" → 填 output title → 保存 →
//        /admin/output 里看到那条 output
//     3. 点 output 的 "delete ×" → confirm() → list 里没了
//   全链路 UI-driven，没碰 MCP。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const WIKI_TITLE = 'Thinking about local-first software';
const WIKI_BODY = 'Local-first is mostly about ownership over data — not about offline.';
const OUTPUT_TITLE = 'Local-first ≠ offline (essay draft)';

test.describe.serial('corpus CRUD: create wiki → promote to output → delete output', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('full CRUD chain UI-driven',
    async ({ adminPage: page }) => {
      await createWikiViaUI(page);
      await promoteWikiToOutputViaUI(page);
      await deleteOutputViaUI(page);
    });
});

async function createWikiViaUI(page: Page): Promise<void> {
  await gotoAdminSection(page, 'wiki');
  await page.waitForURL('**/admin/wiki', { timeout: 5_000 });
  await page.getByTestId('wiki-new-btn').click();
  await page.getByTestId('wiki-create-title').fill(WIKI_TITLE);
  await page.getByTestId('wiki-create-body').fill(WIKI_BODY);
  await page.getByTestId('wiki-create-submit').click();
  await expect(page.getByTestId('wiki-list')).toBeVisible();
  await expect(page.getByText(WIKI_TITLE, { exact: false })).toBeVisible();
}

async function promoteWikiToOutputViaUI(page: Page): Promise<void> {
  // 拿刚 create 那条 row 的 promote 按钮：getByText 找标题所在 li，链 promote 按钮。
  const row = page.locator('[data-testid^="wiki-row-"]', { hasText: WIKI_TITLE });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /promote → output/i }).click();
  // form 出现：用 row 内 scoped locator 命中 promote form 的 title
  const titleInput = row.locator('[data-testid$="-title"]').first();
  await titleInput.fill(OUTPUT_TITLE);
  await row.getByRole('button', { name: /^promote$/i }).click();
  // 跳 admin/output 看新条
  await gotoAdminSection(page, 'output');
  await page.waitForURL('**/admin/output', { timeout: 5_000 });
  await expect(page.getByTestId('output-list')).toBeVisible();
  await expect(page.getByText(OUTPUT_TITLE, { exact: false })).toBeVisible();
}

async function deleteOutputViaUI(page: Page): Promise<void> {
  page.once('dialog', (d) => void d.accept());
  const row = page.locator('[data-testid^="output-row-"]', { hasText: OUTPUT_TITLE });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /delete ×/i }).click();
  await expect(page.getByText(OUTPUT_TITLE, { exact: false })).toHaveCount(0, { timeout: 5_000 });
}
