// wiki-landing.spec.ts —— the owner sets seo_slug + indexed on a public wiki entry,
// and a crawler / deep link can reliably open /<handle>/wiki/<slug> and see the
// content.
//
// User story:
//   Alice wrote a wiki entry titled "Why I Left Hong Kong" and wants search engines to
//   index it. In her AI client, she calls MCP
//   seo.set_wiki_seo(wiki_id, slug='leaving-hk', indexed=true). Later a visitor
//   googles their way to it → clicks the link → sees the title + full text + a way
//   back to the home page.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from "@playwright/test";

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { publishEntry, seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const WIKI = {
  title: 'Why I Left Hong Kong',
  body: 'It came down to where I wanted my kids to grow up.',
  // The URL is derived purely from the tree: path = the title's slug.
  // 'Why I Left Hong Kong' → why-i-left-hong-kong.
  slug: 'why-i-left-hong-kong',
  description: 'A personal note on the move from HK to Canada.',
};

test.describe('SEO wiki landing renders for crawlers and deep links', () => {
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
    await goto(page, `/wiki/${WIKI.slug}`);
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
  await publishEntry(request, apiToken, sid, {
    genre: 'wiki', id: wikiID, excerpt: WIKI.description,
  });
}
