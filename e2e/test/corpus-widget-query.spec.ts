// corpus-widget-query.spec.ts —— the SDK CorpusWidget query language actually shapes what renders on a
// real page: `query="sort:title limit:2"` sorts alphabetically and caps to 2. parseCorpusQuery /
// applyCorpusQuery are unit-tested, but the audit found no e2e rendered CorpusWidget WITH a query prop
// over real data — the widget's own e2e never passes `query` ([[test-covers-capability-not-face]]).
//
// Positive + falsifiable: three published entries (Zeta / Alpha / Mango, created in that non-alpha
// order); the query must render exactly Alpha then Mango (the two alphabetically-first). Count 2 +
// those two in that order proves filter+sort+cap together — Zeta, alphabetically last, is dropped by
// the cap, so its exclusion is asserted by construction, not by an absence check.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki, publishEntry } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { publishPage } from '@/fixtures/microsite-rig';
import { openReader } from '@/fixtures/navigate';

const OWNER = {
  email: 'corpus-query@example.com', password: 'correct-horse-battery-staple',
  handle: 'corpusquery', fullName: 'Corpus Query Owner',
};
const SLUG = 'querypage';
// The page: one CorpusWidget with a query that sorts alphabetically and keeps the first two.
const SOURCE = `import React from 'react';
import { CorpusWidget } from '@standmeet/sdk';
export default function App() {
  return <main><CorpusWidget query="sort:title limit:2" /></main>;
}`;

test.describe('SDK · CorpusWidget query language shapes the rendered cards (sort + cap)', () => {
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password, handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'corpus-query-seed');
    const sid = await initMCP(request, token);
    // Created in a deliberately non-alphabetical order so "sort:title" has to actually reorder.
    for (const title of ['Zeta Query Test', 'Alpha Query Test', 'Mango Query Test']) {
      const note = await seedWiki(request, token, sid, { title, body: `${title} — a note.` });
      await publishEntry(request, token, sid, { genre: 'wiki', id: note.wikiID, excerpt: `${title} excerpt` });
    }
    await publishPage(request, csrf, SLUG, SOURCE); // create → write → build → promote
    await request.dispose();
  });

  test('sort:title limit:2 renders exactly the two alphabetically-first entries, in order', async ({ page }) => {
    test.setTimeout(90_000);
    await openReader(page, `/p/${SLUG}`);
    const widget = page.getByTestId('corpus-widget');
    await expect(widget, 'the CorpusWidget rendered').toBeVisible({ timeout: 20_000 });

    const cards = widget.locator('[data-testid^="corpus-widget-card-"]');
    await expect(cards, 'the cap kept exactly two').toHaveCount(2);
    await expect(cards.nth(0), 'sorted alphabetically: Alpha first').toContainText('Alpha Query Test');
    await expect(cards.nth(1), 'then Mango — and Zeta is dropped by the cap').toContainText('Mango Query Test');
  });
});
