// corpus-tag-filter-spans-the-corpus.spec.ts -- F-L-23: a tag filter must filter
// **the entire corpus**, not just the page that's already loaded.
//
// Found by driving the real environment: `/admin/wiki`'s header reads `574 entries`,
// clicking the `math` tag leaves only 1 entry, while **137** wiki entries in the corpus
// actually carry that tag. The cause: `WikiSection.tsx` shuts off the paginated data
// source entirely once a tag is selected, and falls back to client-side filtering over
// whatever page is already in memory; the header's number comes from a separate, real
// COUNT, so the two numbers sit side by side and neither says which one it is.
//
// This test's shape is built to match that root cause: the tagged entry is made to **fall
// outside the first page**. It's created first (earliest created_at), and pagination is
// created_at DESC, so it sorts last; then a whole page's worth of untagged entries is
// created after it. The old code can only see the first page, so it filters down to 0 --
// when the correct answer is 1.
//
// The assertion checks **whether that specific note is present**, not a count: a count
// drifts with page size and seed count, but "the filter must be able to reach it" does
// not.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { callTool } from '@/fixtures/mcp';
import { initMCP } from '@/fixtures/mcp';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

// NEEDLE_TAG -- unique, so it doesn't collide with other seeds. **The same tag is put on
// two entries**:
//   NEAR -- created last (newest created_at) -> falls on the first page, so the tag chip
//     renders and is clickable;
//   FAR -- created first (oldest created_at) -> falls outside the loaded window, reachable
//     only by a filter that's genuinely pushed down into the query.
// This shape is built to match what was seen in prod: the `math` chip is there, but
// clicking it shows only 1 entry when the corpus actually has 137.
//
// The first version of this test seeded only FAR, and that **passed on the old code too**
// -- because to make its chip render at all, I'd stuffed it into the list hook's window,
// and the client-side filter filters exactly that window. The chip list and the filter
// share the same window, so an entry the filter can't reach also gets no chip: this
// defect can't be triggered by clicking alone, you'd first need to know the tag exists
// from somewhere else.
const NEEDLE_TAG = 'needle-tag';
// FAR_ONLY_TAG -- a tag that's put **only** on FAR. If the tag row is derived from the
// already-loaded page, it wouldn't even get a chip -- unclickable, and so there's no way
// to discover what's missing. On the real vault, `rate-reduction` disappeared exactly
// this way.
const FAR_ONLY_TAG = 'far-only-tag';
const NEAR_TITLE = 'needle-on-the-first-page';
const FAR_TITLE = 'needle-beyond-the-loaded-window';
// FILLER -- the backend's gridPageSize is 30, and the list hook fetches rows by
// defaultCorpusLimit (50). 60 filler entries push FAR past both.
const FILLER = 60;

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

async function seedCorpus(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  void csrf;
  const token = await createAPIToken(request, csrf, 'tag-filter-seed');
  const sid = await initMCP(request, token);

  // FAR is created first -- earliest created_at; pagination sorts DESC, so it falls
  // outside the loaded window.
  await callTool(request, token, sid, 'corpus.create', {
    genre: 'wiki', title: FAR_TITLE, body: 'the tagged entry past the loaded window',
    tags: [NEEDLE_TAG, FAR_ONLY_TAG], source: 'mcp:e2e',
  });
  for (let i = 0; i < FILLER; i += 1) {
    await callTool(request, token, sid, 'corpus.create', {
      genre: 'wiki', title: `filler-${String(i).padStart(2, '0')}`,
      body: 'filler', tags: [], source: 'mcp:e2e',
    });
  }
  // NEAR is created last -- falls on the first page, and the tag chip is rendered because
  // of it.
  await callTool(request, token, sid, 'corpus.create', {
    genre: 'wiki', title: NEAR_TITLE, body: 'the tagged entry on the first page',
    tags: [NEEDLE_TAG], source: 'mcp:e2e',
  });
  await request.dispose();
}

test.describe('corpus · tag filter spans the corpus, not one page', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000);
    await seedCorpus(playwright);
  });

  // A tag filter must be able to reach an entry outside the loaded window (F-L-23).
  test('a tagged entry past the loaded window is still found by its tag',
    async ({ adminPage: page }) => {
      test.setTimeout(180_000);
      await page.getByTestId('admin-nav-wiki').click();
      await page.waitForURL('**/admin/wiki**');

      // Pagination only exists on the grid view; the tree is a lazily-loaded hierarchy,
      // not what this test is about.
      await page.getByRole('button', { name: /grid/i }).click();

      const list = page.getByTestId('wiki-list');
      await expect(list).toBeVisible({ timeout: 30_000 });
      // Non-empty guard: proves the first page is actually rendering something.
      await expect(list).toContainText('filler-', { timeout: 30_000 });
      // And FAR isn't on the first page to begin with -- this step confirms that "the
      // filter must reach past the loaded page" is a real requirement here.
      await expect(list).not.toContainText(FAR_TITLE);

      // The tag row must be sourced from the whole genre: even a tag that's only on the
      // out-of-window entry must have a chip, otherwise it's unclickable -- and
      // "unclickable" looks identical to "this tag doesn't exist" on screen.
      const chips = page.getByTestId('wiki-tag-filter');
      await expect(chips.getByText(FAR_ONLY_TAG, { exact: true })).toBeVisible({ timeout: 30_000 });

      await chips.getByText(NEEDLE_TAG, { exact: true }).click();

      // NEAR appearing = the filter genuinely took effect (non-empty guard, blocks
      // "filtering down to nothing also counts as passing").
      await expect(list).toContainText(NEAR_TITLE, { timeout: 30_000 });
      // FAR appearing = the filter covers the whole corpus, not just the loaded page. The
      // old code goes red on this line.
      await expect(list).toContainText(FAR_TITLE, { timeout: 30_000 });
    });

  // F-L-30 -- the test above **switches to the grid first** before clicking a tag
  // (line 95), so the tree-view path never gets exercised.
  // What it looks like on prod: click `recursive-harness` in tree view, the chip lights
  // up, and the tree **doesn't change by a single row** -- the ten root nodes stay listed
  // exactly as they were; switch to grid at that same instant and dozens of notes carrying
  // that tag are there.
  // Same tag, same moment, two views giving opposite answers, while the lit chip is
  // asserting "already filtered by this".
  //
  // Root cause: the tree branch of `CorpusTreeGrid.tsx:52` renders `CorpusLazyTree`, which
  // **never accepts rows at all** -- so `WikiSection.tsx:136`'s
  // `filterByTag(rows, activeTag)` gets computed and then discarded.
  // F-L-23 fixed the grid half; the tree half **silently became a no-op** in that same
  // change.
  //
  // The criterion doesn't pin "the tree must be filterable" (that's a new capability): it
  // pins **the screen must not lie** -- once a tag is selected, what's shown must actually
  // be the answer for that tag. The product satisfies this by switching to the grid.
  test('picking a tag in tree view does not leave an unfiltered tree under a lit chip',
    async ({ adminPage: page }) => {
      test.setTimeout(180_000);
      await page.getByTestId('admin-nav-wiki').click();
      await page.waitForURL('**/admin/wiki**');
      await page.getByRole('button', { name: /tree/i }).click();

      const list = page.getByTestId('wiki-list');
      await expect(list).toBeVisible({ timeout: 30_000 });
      const chips = page.getByTestId('wiki-tag-filter');
      await chips.getByText(NEEDLE_TAG, { exact: true }).click();
      await expect(list).toBeVisible({ timeout: 30_000 });

      // Once a tag is selected, what's on screen must **be the answer for that tag**:
      // both entries carrying it must be present, and the filler entries that don't
      // carry it must not. The old code goes red here -- the tree doesn't move, every
      // filler is there, FAR is not.
      await expect(list, '挂着这个标签的那两条都得在').toContainText(NEAR_TITLE, { timeout: 30_000 });
      await expect(list, '窗口外那条也得在').toContainText(FAR_TITLE, { timeout: 30_000 });
      const shown = await list.innerText();
      expect(
        shown.includes('filler-'),
        '亮着的 chip 在说「已按这个标签筛过」，那就不该还列着没挂它的条目',
      ).toBe(false);
    });
});
