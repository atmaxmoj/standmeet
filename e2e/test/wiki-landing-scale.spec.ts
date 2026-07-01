// wiki-landing-scale.spec.ts —— 公开 wiki landing + sitemap 也必须覆盖**全量**,不是
// 后端先 load 最新 50 条。GetWikiLanding / IndexedWikiLandings 现在还吃 newest-50 cap:
//   - 深链接打开第 51 条往后(或最旧)的 indexed wiki → 404
//   - sitemap.xml 漏掉 newest-50 之外的 indexed wiki
// 把一条 indexed wiki needle **最先**种下(最旧),再灌 52 条 indexed filler 把它推出
// 最新 50,然后直接深链接打开它 + 查 sitemap。
//
// 现在(50-cap):landing 404 + sitemap 缺 → **红**。改 DB 端按 path 解析后:绿。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'wikilandscale@example.com', password: 'correct-horse-battery-staple',
  handle: 'wikilandscale', fullName: 'Wiki Landing Scale Owner',
};
const NEEDLE_TITLE = 'Quasar Landing';
const NEEDLE_PATH = 'quasar-landing';
const FILLER_COUNT = 52;

let mcpToken = '';

test.describe('public wiki landing + sitemap cover the whole corpus, not newest-50', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    mcpToken = await createAPIToken(request, csrf, 'wikiland-seed');
    const sid = await initMCP(request, mcpToken);
    // needle 最先(最旧),indexed。
    const needleID = await promoteWiki(request, sid, NEEDLE_TITLE,
      `The body of ${NEEDLE_TITLE} entry.`);
    await indexWiki(request, sid, needleID);
    // 52 条 indexed filler,把 needle 推出最新 50。
    for (let i = 0; i < FILLER_COUNT; i += 1) {
      const id = await promoteWiki(request, sid, `Filler Wiki ${i}`, `filler ${i}`);
      await indexWiki(request, sid, id);
    }
    await request.dispose();
  });

  test('deep link to an indexed wiki beyond newest-50 renders (not 404)',
    async ({ page }) => {
      await goto(page, `/wiki/${NEEDLE_PATH}`);
      await expect(page.getByTestId('wiki-landing')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByRole('heading', { name: NEEDLE_TITLE })).toBeVisible();
    });

  test('sitemap.xml lists an indexed wiki beyond newest-50', async ({ page }) => {
    const resp = await page.request.get('http://localhost:8000/sitemap.xml');
    expect(resp.ok()).toBeTruthy();
    expect(await resp.text()).toContain(`/wiki/${NEEDLE_PATH}`);
  });
});

async function promoteWiki(
  request: APIRequestContext, sid: string, title: string, body: string,
): Promise<string> {
  const raw = await callTool<{ raw_id: string }>(
    request, mcpToken, sid, 'raw_dump', { body, source: 'mcp:e2e', tags: [] },
  );
  const wiki = await callTool<{ wiki_id: string }>(
    request, mcpToken, sid, 'promote_to_wiki', { raw_id: raw.raw_id, title, tags: [] },
  );
  return wiki.wiki_id;
}

async function indexWiki(request: APIRequestContext, sid: string, wikiID: string): Promise<void> {
  await callTool<unknown>(request, mcpToken, sid, 'seo.set_wiki_seo', {
    wiki_id: wikiID, excerpt: '', published: true,
  });
}
