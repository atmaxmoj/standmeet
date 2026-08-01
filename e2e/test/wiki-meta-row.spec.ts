// wiki-meta-row.spec.ts —— W3/F1:landing 暴露 sources_count + reader 元信息行渲染
// 「N corpus sources」、breadcrumb「N sources cited」,cover 用真 tag(没 tag 就只
// 「wiki」,不再硬兜底成「corpus」)。
//
// 一条从 1 条 raw 提炼的 wiki(无 tag)→ sources_count=1。

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { publishEntry, seedWiki } from '@/fixtures/corpus';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'metarow@example.com', password: 'correct-horse-battery-staple',
  handle: 'metarow', fullName: 'Meta Row Owner',
};
const PATH = 'lonely-note';

let mcpToken = '';

test.describe('W3/F1 wiki reader meta row: sources count + cover tag', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    mcpToken = await createAPIToken(request, csrf, 'metarow-seed');
    const sid = await initMCP(request, mcpToken);
    // 无 tag,从 1 条 raw 提炼 → sources_count=1。
    const w = await seedWiki(request, mcpToken, sid, {
      title: 'Lonely Note', body: 'A standalone note with no tags.',
    });
    await publishEntry(request, mcpToken, sid, { genre: 'wiki', id: w.wikiID });
    await request.dispose();
  });

  test('meta row shows N corpus sources; breadcrumb shows N sources cited; owner full name',
    async ({ page }) => {
      await goto(page, `/wiki/${PATH}`);
      await expect(page.getByTestId('wiki-landing')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('wiki-sources-count')).toHaveText('1 corpus sources');
      await expect(page.getByTestId('wiki-breadcrumb')).toContainText('1 sources cited');
      await expect(page.getByTestId('wiki-meta')).toContainText(OWNER.fullName);
    });

  test('cover with no tag shows just "wiki", not the hardcoded "corpus" fallback',
    async ({ page }) => {
      await goto(page, `/wiki/${PATH}`);
      const cover = page.getByTestId('wiki-cover');
      await expect(cover).toBeVisible({ timeout: 5_000 });
      await expect(cover).not.toContainText('corpus');
    });
});
