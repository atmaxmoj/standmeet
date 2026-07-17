// resource-store-reset-reloads.spec.ts —— 一次 mutation 把 store 打回 idle 之后，**挂载中的
// 列表必须自己重新拉**，而不是永远停在骨架上。
//
// 真事故（admin-wiki-crud 的 promote 用例在满载下红）。时间线是从浏览器里抓出来的，不是推的：
//   +272ms  POST …/promote           ← 还在飞
//   +287ms  跳到 /admin/output
//   +300ms  GET /corpus/output → 200 ← store 变 ready，列表渲染（/output/tree 也发了）
//   +330ms  POST 落地 → outputStore.reset() → status='idle'
//   → 没有任何人再叫 ensureLoaded（各 hook 的 effect 依赖 `[ensureLoaded]`，身份稳定只跑一次）
//   → pickOutputBodyState 把 'idle' 画成骨架 → **列表永远转圈**
//
// owner 看到的是"卡住了"，不是"坏了"：没有报错、没有空态、控制台干净。POST 先落地就一切正常，
// 所以它只在满载下现形 —— 一个由时序决定的谎（同 names-that-lie 那一类）。
//
// 修在 `useResource`（lib/state/create-resource-store）：那条 effect 依赖 status，idle 就重新武装。
// 修在那里而不是各个 use-X 里，是因为「忘了它」没有任何信号，而 25 个调用方都得对。

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'storereset@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'storereset',
  fullName: 'Store Reset Owner',
};

const WIKI_TITLE = 'Entry To Promote';
const OUTPUT_TITLE = 'Promoted While Navigating';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe.configure({ mode: 'serial' });
test.describe('resource store · a reset while mounted must reload, not strand the skeleton', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('promote then navigate immediately → the output list still resolves', promoteThenNavigate);
});

// promoteThenNavigate —— **故意不等 promote 的 POST 落地**就跳走：那正是踩中竞态的动作，也正是
// owner 会做的（点完就走）。等它落地的话，这条用例修不修都绿。
async function promoteThenNavigate({ adminPage: page }: { adminPage: Page }): Promise<void> {
  await gotoAdminSection(page, 'wiki');
  await page.getByTestId('wiki-new-btn').click();
  await page.getByTestId('wiki-create-title').fill(WIKI_TITLE);
  await page.getByTestId('wiki-create-body').fill('A curated fact worth promoting.');
  await page.getByTestId('wiki-create-submit').click();
  await expect(page.getByText(WIKI_TITLE).first()).toBeVisible({ timeout: 10_000 });

  const row = page.locator('[data-testid^="wiki-row-"]', { hasText: WIKI_TITLE });
  await row.getByRole('button', { name: /promote → output/i }).click();
  await row.locator('[data-testid$="-title"]').first().fill(OUTPUT_TITLE);
  await row.getByRole('button', { name: /^promote$/i }).click();
  await gotoAdminSection(page, 'output'); // 不等 POST：竞态就在这儿

  // 断言的是**好结果**（列表真的解析出来了），不是"没报错"：卡死的形态恰恰是安静的。
  await expect(
    page.getByTestId('output-list').getByText(OUTPUT_TITLE, { exact: false }),
    'a reset() landing after the list loaded must re-arm the fetch, not strand it on the skeleton',
  ).toBeVisible({ timeout: 15_000 });
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  await request.dispose();
}
