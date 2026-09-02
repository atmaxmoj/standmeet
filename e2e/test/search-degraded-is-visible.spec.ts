// search-degraded-is-visible.spec.ts —— F-S-3: when retrieval falls back to a degraded path, the product must say so.
//
// By design, `corpus_search` **is exactly the tool that goes through
// Meilisearch** (`docs/design/open-work-multi-provider-gas-grep-i18n.md:267`);
// `corpus_grep` is a second projection, specifically to catch strings Meili's
// tokenizer misses (mid-word substrings, strings hugging punctuation, CJK
// bigrams — same file, :306). When `MEILI_URL` is empty, `search.New` returns
// nil, retrieval falls back to Postgres full-text, and **writes stop being
// indexed** (`boot_deps.go:142`) — that's a degradation, not another kind of normal.
//
// **The shape of this defect is silence**: `sysinfo.go` originally read
// `if p.search != nil` — when unconfigured, the whole row is simply omitted, so
// **absence looks identical to "everything is fine"** on the health table, when
// absence IS the degradation. db / redis / storage all sit on that table; this
// is the one item that vanishes right when it most needs to speak up. The
// visitor side gives no clue either: a turn where the Chinese-language query
// returns empty gets carried by the model's own English-language query in the
// same turn (F-S-2). **The owner can therefore stay unaware indefinitely that
// they've lost a retrieval method.**
//
// **The assertion lands on `/admin/system`'s health table, not the
// dashboard's needs-your-hand.** Dependency state already lives on that
// table; needs-your-hand is where "the owner should act" belongs, and losing
// one retrieval method isn't like "no AI provider configured" — it doesn't
// lock visitors out (the answer still comes, just worse), so putting it there
// would be over-alarming.
//
// **The two cases are one unit.** Writing only the degraded case, "this row
// reports broken" could just mean it always reports broken; writing only the
// healthy case proves nothing about whether it can speak up at all. Only
// together do they show this row **actually tracks real state**
// ([[assertion-that-cannot-fail]]).
//
// This case rebuilds the backend container twice (enter degraded, exit
// degraded). Degradation is a boot-time switch, there's no cheaper way in;
// afterAll must restore it, or every search case after this one goes green on
// the wrong path — which is exactly the mechanism that let this go undetected
// for so long ([[which-path-is-the-green-on]]).

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken, setSearchDegraded } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'search-degraded@example.com', password: 'correct-horse-battery-staple',
  handle: 'searchdeg', fullName: 'Search Degraded Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('F-S-3 · a degraded search path is stated, not silent', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await loginAPI(request, OWNER.email, OWNER.password);
    await request.dispose();
  });

  test.afterAll(() => { setSearchDegraded(false); });

  test('engine attached → the health table names search and calls it fine',
    async ({ adminPage }) => {
      const row = (await searchHealthRow(adminPage)).toLowerCase();
      expect(row, 'a healthy engine is not reported as a problem')
        .not.toMatch(/no lexical index|not being indexed|fell back/);
      expect(row, 'and it is reported as ok').toContain('ok');
    });

  test('engine gone → the same row says the index is missing and writes are unindexed',
    async ({ adminPage }) => {
      setSearchDegraded(true);
      // That this row **is still here** is itself an assertion — the old
      // `if p.search != nil` used to make it vanish entirely in this state, and
      // vanishing IS the degradation. searchHealthRow goes red at that step if it can't find it.
      const row = (await searchHealthRow(adminPage)).toLowerCase();
      expect(row, 'the owner is told the lexical index is not attached')
        .toContain('no lexical index attached');
      // The second consequence needs to be stated too: writes stop reaching the index, so old content won't backfill itself once the engine returns.
      expect(row, 'and that new writes are not being indexed')
        .toContain('not being indexed');
      expect(row, 'and the row is marked down, not ok').toContain('down');
    });
});

// searchHealthRow —— the full search row on /admin/system's health table (name + description + status).
//
// **Both mistakes made while writing this were in this function — written down so they aren't repeated:**
// One: picking the row by innerText only gets the name — name and detail are
//     two separate divs, and the sentence being tested lives in detail.
//     Now takes the whole row via `health-row-search`.
// Two: a positive-control assertion of "panel visible" used to move on, but at
//     that point the panel was still showing `healthList`'s loading placeholder
//     (`—` / `loading…`), so "data hasn't arrived yet" got misread as "this row
//     doesn't exist". Waiting for **the specific row** to appear naturally
//     separates the two ([[red-in-the-wrong-place]]).
async function searchHealthRow(page: Page): Promise<string> {
  await goto(page, '/admin/system');
  const row = page.getByTestId('health-row-search');
  await expect(row, 'the search row is in the health table at all').toBeVisible({ timeout: 15_000 });
  return row.innerText();
}
