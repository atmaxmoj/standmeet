// wiki-related-rails.spec.ts — F2: the two related rails at the bottom of the wiki
// reader.
//   - read next  = outbound links (what this entry's [[X]] points to) = landing.related
//   - cited by   = inbound links (others pointing at this entry) = landing.cited_by
// The backend's landing endpoint has long returned related/cited_by (the wiki_refs edge
// graph); this test checks that the frontend renders them as rails.
//
// The edge: Entry A's body contains [[Target B]] → A→B. So A's read next has B; B's
// cited by has A.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { publishEntry, seedWiki } from '@/fixtures/corpus';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'rails@example.com', password: 'correct-horse-battery-staple',
  handle: 'railsowner', fullName: 'Rails Owner',
};

let mcpToken = '';

test.describe('F2 wiki reader related rails (read next / cited by)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    mcpToken = await createAPIToken(request, csrf, 'rails-seed');
    const sid = await initMCP(request, mcpToken);
    // Seed B first (so A's [[Target B]] can resolve); then seed A (the A→B edge gets
    // built at promote time).
    const b = await seedWiki(request, mcpToken, sid, {
      title: 'Target B', body: 'The target entry body.',
    });
    const a = await seedWiki(request, mcpToken, sid, {
      title: 'Entry A', body: 'See [[Target B]] for the details.',
    });
    await indexWiki(request, sid, a.wikiID);
    await indexWiki(request, sid, b.wikiID);
    await request.dispose();
  });

  test('A reader shows a "read next" rail linking the outbound target', async ({ page }) => {
    await goto(page, '/wiki/entry-a');
    await expect(page.getByTestId('wiki-landing')).toBeVisible({ timeout: 5_000 });
    const rail = page.getByTestId('related-rail-read-next');
    await expect(rail).toBeVisible();
    await expect(rail.getByRole('link', { name: /Target B/ }))
      .toHaveAttribute('href', '/wiki/target-b');
    // A has no inbound links → the cited by rail doesn't appear.
    await expect(page.getByTestId('related-rail-cited-by')).toHaveCount(0);
  });

  test('B reader shows a "cited by" rail linking the inbound source', async ({ page }) => {
    await goto(page, '/wiki/target-b');
    await expect(page.getByTestId('wiki-landing')).toBeVisible({ timeout: 5_000 });
    const rail = page.getByTestId('related-rail-cited-by');
    await expect(rail).toBeVisible();
    await expect(rail.getByRole('link', { name: /Entry A/ }))
      .toHaveAttribute('href', '/wiki/entry-a');
    await expect(page.getByTestId('related-rail-read-next')).toHaveCount(0);
  });
});

async function indexWiki(request: APIRequestContext, sid: string, wikiID: string): Promise<void> {
  await publishEntry(request, mcpToken, sid, { genre: 'wiki', id: wikiID });
}
