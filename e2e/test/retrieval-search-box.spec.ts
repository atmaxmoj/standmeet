// retrieval-search-box.spec.ts —— F-A-2 thesis guard.
//
// The visitor chat used to render a direct corpus-search box: type a query → corpus_search →
// a hit list → click → land on the raw-note reader (/wiki/<path>) and read the corpus VERBATIM.
// That (a) leaks the agent-internal corpus_search tool into the visitor UI as a control and
// (b) contradicts the product thesis printed on /gate — "a chat, not a page… never recite
// corpus verbatim." The box was removed; a visitor reaches the corpus only THROUGH the agent
// (owner voice / redaction / no-verbatim). This guard asserts the box is gone.

import type { Page } from '@playwright/test';

import { test, expect } from '@/fixtures/test';

import { seedWiki } from '@/fixtures/corpus';
import { goto } from '@/fixtures/navigate';
import { setPublished, setupRetrievalOwner, type RetrievalOwner } from '@/fixtures/retrieval';

let O: RetrievalOwner;

// enter — the ?code entry point → fill in a name at the name picker → submit → wait
// for the session to be issued (only then does the search box appear).
async function enter(page: Page): Promise<void> {
  await goto(page, `/?code=${O.fullCode}`);
  const session = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200, { timeout: 15_000 },
  );
  await page.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('visitor-name-input').fill('Searcher');
  await page.getByTestId('visitor-name-submit').click();
  await session;
}

test.describe('F-A-2 · visitor chat exposes no direct corpus-search box', () => {
  test.beforeAll(async ({ playwright }) => {
    O = await setupRetrievalOwner(playwright, 'searchbox');
    const { wikiID } = await seedWiki(O.request, O.apiToken, O.sid, {
      title: 'Searchbox Target', body: 'OSCARKW findable via the box', path: 'searchbox-target',
    });
    await setPublished(O.request, O.csrf, wikiID, true); // published corpus exists to (not) search
  });
  test.afterAll(async () => { await O.request.dispose(); });

  test('a code visitor gets a chat, not a searchable corpus browser (thesis)', async ({ page }) => {
    await enter(page); // full code-visitor session (the tier the box used to render for)
    // No direct corpus-search input, no result list, no empty-state — the visitor cannot
    // search + open raw notes verbatim; they reach the corpus only through the agent.
    await expect(page.getByTestId('corpus-search-input')).toHaveCount(0);
    await expect(page.getByTestId('corpus-search-result')).toHaveCount(0);
    // The chat composer IS present (they can ask the agent).
    await expect(page.getByTestId('chat-input-field')).toBeVisible();
  });
});
