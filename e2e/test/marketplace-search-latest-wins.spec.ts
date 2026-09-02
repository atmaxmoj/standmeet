// marketplace-search-latest-wins.spec.ts — F-F-6: a slower, older response must not
// overwrite a result that just came back from a newer search.
//
// `use-marketplace-search.ts`'s effect fires a request every time the query changes,
// and `loadPage` **neither orders nor cancels** them — whichever comes back last
// wins. So if "the full catalog for an empty query" comes back later than "the one
// with q", the screen ends up showing **the unfiltered catalog + whatever word you
// typed in the search box**: the owner types a word by hand and gets a screen full
// of unrelated results, with no error anywhere.
//
// This is grounded in a real observation: in the full suite,
// `marketplace-needs-connector` went red twice (18s), and passed at 7.9s running
// alone. The failure snapshot showed `tz-booking` in the search box while the grid
// showed Algorithmic Art / Brand Guidelines / …
//
// **Only the first request (the one with no q) is held back**; the one with q is
// left untouched — that way a red result can only mean "the stale response won".
// Without injecting the delay this test is permanently green, so the delay itself
// is what makes this test's criterion meaningful.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { seedOwnerLoggedIn, teardownSeed, OWNER, type BaseSeed } from '@/fixtures/gcal-setup';
import { gotoAdminSection } from '@/fixtures/navigate';

// The "needs a connector" skill (appended to the mock marketplace catalog); used as
// the search target.
const TARGET = 'tz-booking';
// Every card in the grid. **Don't guess a neighboring card's id** — guess wrong and
// `toHaveCount(0)` is trivially true forever, so that assertion could never catch
// anything ([[assertion-that-cannot-fail]]). Counting the total can't be guessed
// wrong: after a search only the target card should remain, while the full catalog
// on screen is a two-digit number.
const ANY_CARD = '[data-testid^="market-skill-"]';

// One unfiltered page is 12 cards (PAGE_LIMIT). After filtering it must be fewer than
// that — otherwise "the same count before and after filtering" would also satisfy
// the "unchanged" assertion below, and that's exactly what the defect looks like.
const FULL_LISTING_MIN = 12;

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

const SEARCH_PATH = '**/api/admin/marketplace/search*';

function isUnfiltered(url: string): boolean {
  return new URL(url).searchParams.get('q') === null;
}

// holdUnfilteredSearch — holds back **only the request with no `q`** until the
// caller releases it; the one with q passes through normally.
//
// **Not a sleep.** Pausing for a fixed number of seconds only "hopes" it comes back
// late enough; holding and then releasing makes the ordering a fact: the request
// with q is guaranteed to land first, and the full-catalog one is guaranteed to land
// after it. That's exactly the question this test asks: "does the stale response
// that arrives later win?"
// **The route registration must be awaited.** The first version wrote
// `void page.route(...)`, so navigation could race ahead of the route being
// installed — that request would never actually get held, and red/green would go
// back to being a matter of luck.
async function holdUnfilteredSearch(page: Page): Promise<{ release: () => void }> {
  let release = (): void => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(SEARCH_PATH, async (route) => {
    if (isUnfiltered(route.request().url())) await held;
    await route.continue();
  });
  return { release: () => { release(); } };
}

test.describe('marketplace search · a slow earlier response must not overwrite a newer one (F-F-6)', () => {
  let seed: BaseSeed | undefined;

  test.beforeAll(async ({ playwright }) => { seed = await seedOwnerLoggedIn(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('typing a query while the full listing is still in flight still shows the query’s results',
    async ({ adminPage }) => {
      const { release } = await holdUnfilteredSearch(adminPage);
      await gotoAdminSection(adminPage, 'skills');
      await adminPage.waitForURL('**/admin/skills');
      await adminPage.getByTestId('skills-tab-marketplace').click();

      // Type without waiting for the first request to return — that's exactly how a
      // real person uses it: the panel is still spinning, but they already know what
      // they want to search for.
      await adminPage.getByTestId('marketplace-search').fill(TARGET);

      // The target card must appear…
      await expect(
        adminPage.getByTestId(`market-skill-${TARGET}`),
        'the query’s own result must be on screen',
      ).toBeVisible({ timeout: 20_000 });

      // Record however many cards are on screen after filtering, right here. **Not a
      // hard-coded number** — how many results a query matches is search's own
      // business; this test asks whether a stale response changes the screen, so it
      // compares before vs. after.
      const filteredCount = await adminPage.locator(ANY_CARD).count();
      expect(filteredCount, 'the query narrowed the grid at all').toBeLessThan(FULL_LISTING_MIN);

      // Now release the held-back request, **wait for it to actually reach the
      // browser**, then check the screen.
      // "The stale response has arrived" is a fact at that point, not a guess based
      // on waiting a few seconds.
      const stale = adminPage.waitForResponse(
        (r) => r.url().includes('/marketplace/search') && isUnfiltered(r.url()),
      );
      release();
      await stale;

      await expect(
        adminPage.locator(ANY_CARD),
        'the stale unfiltered listing must not change what the query put on screen',
      ).toHaveCount(filteredCount);
      await expect(adminPage.getByTestId(`market-skill-${TARGET}`)).toBeVisible();
    });
});
