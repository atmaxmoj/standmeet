// wiki-landing-scale.spec.ts —— the public wiki landing + sitemap must cover **the whole
// corpus**, not whatever the backend loads first (newest 50). GetWikiLanding /
// IndexedWikiLandings still eat a newest-50 cap right now:
//   - deep-linking to indexed wiki #51 onward (or the oldest) → 404
//   - sitemap.xml is missing any indexed wiki beyond the newest 50
// Seed one indexed wiki needle **first** (so it's the oldest), then flood in 52 indexed
// fillers to push it out of the newest 50, then deep-link straight to it + check the
// sitemap.
//
// Right now (50-cap): landing 404 + sitemap missing it → **RED**. Once the DB side resolves
// by path: green.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';
import { publishEntry } from '@/fixtures/corpus';

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
    // needle first (oldest), indexed.
    const needleID = await promoteWiki(request, sid, NEEDLE_TITLE,
      `The body of ${NEEDLE_TITLE} entry.`);
    await indexWiki(request, sid, needleID);
    // 52 indexed fillers, to push the needle out of the newest 50.
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
  const raw = await callTool<{ id: string }>(
    request, mcpToken, sid, 'corpus.create',
    { genre: 'raw', body, source: 'mcp:e2e', tags: [] },
  );
  const wiki = await callTool<{ id: string }>(
    request, mcpToken, sid, 'corpus.promote',
    { genre: 'raw', id: raw.id, title, tags: [] },
  );
  return wiki.id;
}

async function indexWiki(request: APIRequestContext, sid: string, wikiID: string): Promise<void> {
  await publishEntry(request, mcpToken, sid, { genre: 'wiki', id: wikiID });
}
