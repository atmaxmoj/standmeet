// corpus-widget-clean-preview.spec.ts —— the CorpusWidget inline reveal must read as PROSE, not raw
// markup. The widget ships no full markdown renderer (the reader page does), so its light pass has to:
//   • turn `[text](url)` links into their text (never leak the `](url)` markup or the URL), and
//   • drop scaffolding/metadata blocks — a `Parent:` nav line, an Obsidian `[!i18n]`/`[!lang]` callout,
//     the i18n radio `<label>` HTML.
// The audit (a real note rendered "Parent: [corpus](/wiki/…)" verbatim) showed the old stripMarkdown
// left links raw and passed the Parent line through. This is the falsifiable guard.
//
// One note with a Parent nav line + a link in that line + a link inside real prose. After reveal, the
// prose link must read as text ("asset in the pool"), and none of the markup — "Parent:", "](", the
// URLs — may appear. RED on the old stripper (it left "](" and "Parent:"); green on the new one.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki, publishEntry } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { publishPage } from '@/fixtures/microsite-rig';
import { openReader } from '@/fixtures/navigate';

const OWNER = {
  email: 'corpus-clean@example.com', password: 'correct-horse-battery-staple',
  handle: 'corpusclean', fullName: 'Corpus Clean Owner',
};
const SLUG = 'cleanpage';
const NOTE_PATH = 'preview-probe/asset-pool';
// Body with the exact shapes the audit caught: a `Parent:` nav line (with a link) and a link inside prose.
const BODY = [
  'Global thing: one store, reference accounting.',
  '',
  'Parent: [key-designs](/wiki/software/keydesigns)',
  '',
  'The real prose explains that a referenced [asset in the pool](/wiki/software/assetpool) refuses to be deleted, and names its referrers.',
].join('\n');
// Scope the widget to just this probe subtree so the card set is deterministic.
const SOURCE = `import React from 'react';
import { CorpusWidget } from '@standmeet/sdk';
export default function App() {
  return <main><CorpusWidget query="path:preview-probe" /></main>;
}`;

test.describe('SDK · CorpusWidget inline reveal is clean prose (links → text, metadata dropped)', () => {
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password, handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'corpus-clean-seed');
    const sid = await initMCP(request, token);
    const note = await seedWiki(request, token, sid, { title: 'Asset Pool Probe', path: NOTE_PATH, body: BODY });
    await publishEntry(request, token, sid, { genre: 'wiki', id: note.wikiID, excerpt: 'Global thing: one store.' });
    await publishPage(request, csrf, SLUG, SOURCE);
    await request.dispose();
  });

  test('the revealed body shows link text, no raw markup, no Parent metadata', async ({ page }) => {
    test.setTimeout(90_000);
    await openReader(page, `/p/${SLUG}`);
    const widget = page.getByTestId('corpus-widget');
    await expect(widget, 'the CorpusWidget rendered').toBeVisible({ timeout: 20_000 });

    // Scoped to the probe subtree, so there's exactly one card — click it by prefix (the reader path
    // derives from slugified titles, not the seed's flat path, so don't hardcode the leaf slug).
    const cards = widget.locator('[data-testid^="corpus-widget-card-"]');
    await expect(cards, 'exactly the probe note is in scope').toHaveCount(1);
    await cards.first().click();
    const body = widget.locator('[data-testid^="corpus-widget-body-"]').first();
    await expect(body, 'the note body revealed inline').toBeVisible({ timeout: 15_000 });

    // Auto-retry until the async note body has loaded (past the "reading…" placeholder), then the
    // link must read as its text.
    await expect(body, 'link rendered as its text')
      .toContainText('referenced asset in the pool refuses to be deleted', { timeout: 15_000 });
    // none of the markup / metadata leaks
    const text = (await body.innerText()).trim();
    expect(text, 'no raw link markup').not.toContain('](');
    expect(text, 'no link URL leaked').not.toContain('/wiki/software/assetpool');
    expect(text, 'the Parent nav line is dropped').not.toContain('Parent:');
  });
});
