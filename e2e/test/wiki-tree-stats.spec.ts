// wiki-tree-stats.spec.ts —— F3:侧栏脚定位计数(entries / roots / gated)。纯 COUNT
// 聚合,不拉树、不破坏懒加载。计数是 owner 级(总数 / 根数 / 非公开数),所以即便匿名
// 树里只看得到公开的,脚上仍标出「一共多少、其中多少 gated」。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';
import { seedWiki } from '@/fixtures/corpus';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'treestats@example.com', password: 'correct-horse-battery-staple',
  handle: 'treestats', fullName: 'Tree Stats Owner',
};

let mcpToken = '';

test.describe('F3 wiki sidebar stats (entries / roots / gated)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    mcpToken = await createAPIToken(request, csrf, 'treestats-seed');
    const sid = await initMCP(request, mcpToken);
    // 3 条根:Alpha/Beta 公开(indexed),Gamma 不公开(gated → 计 gated 数)。
    const a = await seedWiki(request, mcpToken, sid, { title: 'Alpha', body: 'a' });
    const b = await seedWiki(request, mcpToken, sid, { title: 'Beta', body: 'b' });
    await seedWiki(request, mcpToken, sid, { title: 'Gamma', body: 'g' }); // 不 index → gated
    await indexWiki(request, sid, a.wikiID);
    await indexWiki(request, sid, b.wikiID);
    await request.dispose();
  });

  test('sidebar footer shows entries / roots / gated counts', async ({ page }) => {
    await goto(page, '/wiki/alpha');
    await expect(page.getByTestId('wiki-landing')).toBeVisible({ timeout: 5_000 });
    const stats = page.getByTestId('wiki-tree-stats');
    await expect(stats).toBeVisible();
    await expect(stats).toContainText('3 entries');
    await expect(stats).toContainText('3 roots');
    await expect(stats).toContainText('1 gated');
  });
});

async function indexWiki(request: APIRequestContext, sid: string, wikiID: string): Promise<void> {
  await callTool<unknown>(request, mcpToken, sid, 'seo.set_wiki_seo', {
    wiki_id: wikiID, seo_description: '', seo_indexed: true,
  });
}
