// corpus-delete-does-not-look-safe.spec.ts —— UX-32:破坏性动作在悬停时不许跟安全动作长得一样。
//
// 设计评审看出来的:raw 每行三个动作 —— promote / edit / delete —— **hover 时全部收敛到同一个
// 朱砂**(`RawRowList.tsx:183/191/199` 都是 `hover:…-(--color-accent)`)。于是「提升进 wiki」
// 「编辑」和「永久删除」在鼠标停下那一刻反馈完全相同,而 hover 正是点击前最后一次分辨机会。
// 静止态更糟:delete 用的是三者里最淡的 `--color-faint`。
//
// 断的是**算出来的颜色**,不是 class 名:class 名换个写法就能骗过去,而读者看到的是像素。
// 两条断言方向相反 ——
//   1. delete 悬停色 ≠ edit 悬停色(危险要认得出来);
//   2. delete 悬停时确实**变了**色(否则「两者不同」可以靠"delete 根本没有悬停反馈"满足,
//      那是另一种坏)。

import { test, expect } from '@/fixtures/test';
import type { Locator } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

async function colorOf(el: Locator): Promise<string> {
  return el.evaluate((n) => getComputedStyle(n).color);
}

test.describe('corpus · a destructive row action must not read as a safe one', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'delete-look-seed');
    const sid = await initMCP(request, token);
    await callTool(request, token, sid, 'corpus.create', {
      genre: 'raw', body: 'a raw thought to delete', source: 'mcp:e2e', tags: [],
    });
    await request.dispose();
  });

  test('hovering delete does not land on the same colour as hovering edit',
    async ({ adminPage: page }) => {
      test.setTimeout(180_000);
      await page.getByTestId('admin-nav-raw').click();
      await page.waitForURL('**/admin/raw**');

      const del = page.locator('[data-testid^="raw-delete-"]').first();
      const edit = page.locator('[data-testid^="raw-edit-"]').first();
      await expect(del).toBeVisible({ timeout: 30_000 });
      await expect(edit).toBeVisible({ timeout: 30_000 });

      const delResting = await colorOf(del);

      await del.hover();
      const delHover = await colorOf(del);
      await edit.hover();
      const editHover = await colorOf(edit);

      // 2) delete 悬停确实有反馈 —— 否则下面那条可以靠「它根本不响应」满足。
      expect(delHover, 'delete must react to hover at all').not.toBe(delResting);
      // 1) 而那个反馈必须跟安全动作分得开。
      expect(delHover, 'destructive hover must not equal the safe action hover').not.toBe(editHover);
    });
});
