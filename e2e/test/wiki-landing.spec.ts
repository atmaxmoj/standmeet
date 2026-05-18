// wiki-landing.spec.ts —— owner 给一条 public wiki 设 seo_slug + indexed，
// 爬虫 / 深度链接能稳定打开 /<handle>/wiki/<slug> 看到内容。
//
// 用户故事：
//   sijie 写了一条"为什么我离开香港"的 wiki，想让搜索能 index 这条。在
//   AI client 里调 MCP seo.set_wiki_slug(wiki_id, slug='leaving-hk', indexed=true)。
//   稍后访客 google 搜到这条 → 点链接 → 看到标题 + 全文 + 引导回主页。

import { test, expect } from '@playwright/test';
import type { APIRequestContext } from "@playwright/test";

import { claim, createAPIToken, login as loginAPI } from '../helper/admin';
import { seedPublicWiki } from '../helper/corpus';
import { resetInstance, findSetupToken } from '../helper/docker';
import { callTool, initMCP } from '../helper/mcp';
import { goto } from '../helper/navigate';

const OWNER = {
  email: 'sijie@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'sijie',
  fullName: 'Sijie Wang',
};

const WIKI = {
  title: 'Why I Left Hong Kong',
  body: 'It came down to where I wanted my kids to grow up.',
  slug: 'leaving-hk',
  description: 'A personal note on the move from HK to Canada.',
};

test.describe.serial('SEO wiki landing renders for crawlers and deep links', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await setupIndexedWiki(request);
    await request.dispose();
  });

  test('open /<handle>/wiki/<slug> → title + body visible', async ({ page }) => {
    await goto(page, `/${OWNER.handle}/wiki/${WIKI.slug}`);
    await expect(page.getByTestId('wiki-landing')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('heading', { name: WIKI.title })).toBeVisible();
    await expect(page.getByText(WIKI.body, { exact: false })).toBeVisible();
  });
});

async function setupIndexedWiki(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'seed-token');
  const sid = await initMCP(request, apiToken);
  const { wikiID } = await seedPublicWiki(request, apiToken, sid, {
    body: WIKI.body,
    title: WIKI.title,
    tags: ['personal'],
  });
  await callTool<unknown>(request, apiToken, sid, 'seo.set_wiki_slug', {
    wiki_id: wikiID,
    seo_slug: WIKI.slug,
    seo_description: WIKI.description,
    seo_indexed: true,
  });
}
