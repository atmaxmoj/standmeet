// wiki-topbar-reading.spec.ts —— F3:reader 顶栏阅读态 —— 打开一条 wiki,顶栏标出
// 正在读的条目标题(index/列表不传,所以只 reader 有)。

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { publishEntry, seedWiki } from '@/fixtures/corpus';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'readtop@example.com', password: 'correct-horse-battery-staple',
  handle: 'readtop', fullName: 'Read Top Owner',
};
const TITLE = 'Reading State Entry';
const PATH = 'reading-state-entry';

test.describe('F3 wiki reader TopBar reading-state', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'readtop-seed');
    const sid = await initMCP(request, token);
    const w = await seedWiki(request, token, sid, { title: TITLE, body: 'body of the entry.' });
    await publishEntry(request, token, sid, { genre: 'wiki', id: w.wikiID });
    await request.dispose();
  });

  test('opening a wiki shows the entry title in the TopBar reading-state',
    async ({ page }) => {
      await goto(page, `/wiki/${PATH}`);
      await expect(page.getByTestId('wiki-landing')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('wiki-topbar-reading')).toContainText(TITLE);
    });
});
