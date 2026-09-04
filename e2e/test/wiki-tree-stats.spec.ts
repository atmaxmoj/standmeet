// wiki-tree-stats.spec.ts -- F3: the sidebar footer's location counts (entries / roots
// / gated). A pure COUNT aggregate that never pulls the tree, and never breaks lazy
// loading. The counts are owner-level (totals / root count / non-public count), so
// even when an anonymous tree only shows what's public, the footer still shows the
// total and how many of those are gated.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { publishEntry, seedWiki } from '@/fixtures/corpus';
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
    // 3 roots: Alpha/Beta are public (indexed), Gamma is not (gated -> counted in the gated total).
    const a = await seedWiki(request, mcpToken, sid, { title: 'Alpha', body: 'a' });
    const b = await seedWiki(request, mcpToken, sid, { title: 'Beta', body: 'b' });
    await seedWiki(request, mcpToken, sid, { title: 'Gamma', body: 'g' }); // never indexed -> gated
    await indexWiki(request, sid, a.wikiID);
    await indexWiki(request, sid, b.wikiID);
    await request.dispose();
  });

  test('sidebar footer shows entries / roots / gated counts', async ({ page }) => {
    // the sidebar (with its footer stats) is display:none below 1500px (c215f0be).
    await page.setViewportSize({ width: 1512, height: 900 });
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
  await publishEntry(request, mcpToken, sid, { genre: 'wiki', id: wikiID });
}
