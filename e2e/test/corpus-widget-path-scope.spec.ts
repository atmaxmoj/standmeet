// corpus-widget-path-scope.spec.ts —— the SDK CorpusWidget `query="path:<prefix>"` scopes the rendered
// cards to one subtree over REAL data. parseCorpusQuery/applyCorpusQuery unit-test the path filter, and
// corpus-widget-query.spec.ts covers sort+cap — but no e2e rendered a CorpusWidget scoped BY PATH against
// a real corpus (that spec's own note flags the gap). The per-project intro microsites lean on exactly
// this (each section shows only its own subtree), so it needs a falsifiable end-to-end guard.
//
// Positive + falsifiable: three published notes in two subtrees — 'scoped/alpha', 'scoped/beta',
// 'elsewhere/gamma'. `query="path:scoped sort:title"` must render EXACTLY Alpha then Beta. Gamma sits in a
// different subtree, so its exclusion is asserted by construction (count 2), not by an absence check — if
// the path filter broke and passed everything through, the count would be 3 and this fails.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki, publishEntry } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { publishPage } from '@/fixtures/microsite-rig';
import { openReader } from '@/fixtures/navigate';

const OWNER = {
  email: 'corpus-scope@example.com', password: 'correct-horse-battery-staple',
  handle: 'corpusscope', fullName: 'Corpus Scope Owner',
};
const SLUG = 'scopepage';
// One CorpusWidget scoped to the 'scoped' subtree, sorted so the assertion is order-exact.
const SOURCE = `import React from 'react';
import { CorpusWidget } from '@standmeet/sdk';
export default function App() {
  return <main><CorpusWidget query="path:scoped sort:title" /></main>;
}`;

test.describe('SDK · CorpusWidget query="path:<prefix>" scopes rendered cards to one subtree', () => {
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password, handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'corpus-scope-seed');
    const sid = await initMCP(request, token);
    // Two in the 'scoped' subtree, one in 'elsewhere' — the leaf's tree path reconstructs to opts.path.
    const seeds: Array<{ title: string; path: string }> = [
      { title: 'Alpha In Scope', path: 'scoped/alpha' },
      { title: 'Beta In Scope', path: 'scoped/beta' },
      { title: 'Gamma Elsewhere', path: 'elsewhere/gamma' },
    ];
    for (const s of seeds) {
      const note = await seedWiki(request, token, sid, { title: s.title, path: s.path, body: `${s.title} — a note.` });
      await publishEntry(request, token, sid, { genre: 'wiki', id: note.wikiID, excerpt: `${s.title} excerpt` });
    }
    await publishPage(request, csrf, SLUG, SOURCE); // create → write → build → promote
    await request.dispose();
  });

  test('path:scoped renders exactly the two scoped notes, and excludes the elsewhere one', async ({ page }) => {
    test.setTimeout(90_000);
    await openReader(page, `/p/${SLUG}`);
    const widget = page.getByTestId('corpus-widget');
    await expect(widget, 'the CorpusWidget rendered').toBeVisible({ timeout: 20_000 });

    const cards = widget.locator('[data-testid^="corpus-widget-card-"]');
    await expect(cards, 'only the two under path:scoped survived the filter').toHaveCount(2);
    await expect(cards.nth(0), 'sorted alphabetically: Alpha first').toContainText('Alpha In Scope');
    await expect(cards.nth(1), 'then Beta — Gamma (elsewhere/*) is filtered out').toContainText('Beta In Scope');
    // Gamma's card testid carries its path; it must not be on the page at all.
    await expect(widget.locator('[data-testid="corpus-widget-card-elsewhere/gamma"]'),
      'the out-of-subtree note is absent').toHaveCount(0);
  });
});
