// corpus-tree-epoch-inflight.spec.ts — **an entry that was just created must appear in the tree,
// even while the tree is still fetching.**
//
// ①🔴 The full suite's 723rd case went red here: the title said `wiki · 5 entries`, the
// sidebar pulse also said 5, but the tree only had 4 rows — the missing one was exactly the
// entry that had just been created. Waited 15 seconds and it never showed up: it isn't slow, it's
// **wedged for good**.
//
// ②🎯 `useAdminTreeLayer` expresses invalidation with two effects: one does `setNodes(null)`
// (keyed by epoch), the other says "if nodes is null, go fetch." When nodes is **already null**,
// that invalidation step is a no-op — React bails out of a setState to the same value: no
// re-render, and the second effect never re-runs. So the path plays out as:
//
//   land on the page → the tree starts fetching (hasn't returned yet) → the owner creates an
//   entry → epoch++ → `setNodes(null)` does nothing → the **stale** in-flight list comes back →
//   `nodes !== null` → it never fetches again from that point on.
//
// On screen it looks like "the count says 5, the list shows 4 rows", and it never resolves on
// its own. All it takes for a real owner to hit this is **acting before the list finishes
// loading** — the slower the network, the easier it is to trigger, and it's precisely on a slow
// network that people are most eager to act right away.
//
// ③🧪 This spec turns that window into something **deterministic**: the tree fetch's response is
// held back (the request has genuinely gone out, the answer is in hand server-side, but the
// browser hasn't received it yet), and the create lands exactly in that gap. How long it's held
// isn't decided by a timer — the test releases it itself, so the window can't close early just
// because the machine happens to be fast.

import type { Page } from '@playwright/test';

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'tree-epoch@example.com', password: 'correct-horse-battery-staple',
  handle: 'treeepoch', fullName: 'Tree Epoch Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('corpus tree · creating while the tree is still fetching', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('an entry created mid-fetch still shows up in the tree', async ({ adminPage: page }) => {
    await gotoAdminSection(page, 'wiki');
    // Need one entry to start with: an empty corpus renders EmptyState, and the tree never
    // mounts at all, so this case would test nothing.
    await createWiki(page, 'tree seed note');
    await expect(rowFor(page, 'tree seed note')).toBeVisible({ timeout: 15_000 });

    // marks — this spec **must prove for itself that it actually hit that window**. If the
    // order of these three timestamps is wrong, it's testing a different path entirely, while
    // going green as if it were the right one.
    const marks: { fetched: number[]; delivered: number[]; created: number[] } = {
      fetched: [], delivered: [], created: [],
    };
    // release — when the held-back response gets let through. **A signal, not a timer**: a
    // timer's duration races against how fast or slow the machine is, and the run that loses that
    // race looks exactly like a passing one.
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    // **Let the request go out for real first, then hold back the response.** Holding it before
    // `continue()` would just delay the whole request until after the create — in which case the
    // server would return fresh data, and the tree would obviously be correct. "In flight" means:
    // the list is already fixed on the server side (the pre-create version), the browser just
    // hasn't received it yet.
    await page.route('**/corpus/wiki/tree*', async (route) => {
      const res = await route.fetch();
      const body = await res.body();
      marks.fetched.push(Date.now());
      await held;
      await route.fulfill({ response: res, body });
      marks.delivered.push(Date.now());
    });
    page.on('response', (res) => {
      const path = new URL(res.url()).pathname;
      const isCreate = res.request().method() === 'POST' && /\/corpus\/wiki$/.test(path);
      isCreate && marks.created.push(Date.now());
    });
    await page.reload();

    // **Wait for the stale list to be pinned before acting**, rather than "acting ahead of it."
    // When the tree's fetch actually goes out isn't under this spec's control (it's queued after
    // the flat list), so acting too early would turn this into a race — and races can be lost.
    await expect.poll(() => marks.fetched.length, { timeout: 15_000 }).toBeGreaterThan(0);
    await createWiki(page, 'tree race note');
    await expect.poll(() => marks.created.length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(marks.delivered.length, 'the stale list has not reached the browser yet').toBe(0);
    expect(
      marks.created[0] ?? 0,
      'the create must land after the stale list was pinned',
    ).toBeGreaterThan(marks.fetched[0] ?? Number.MAX_SAFE_INTEGER);
    release();

    // This entry must appear. The timeout given is far longer than the release itself needs: what
    // matters is "does it show up at all", not "is it fast enough".
    await expect(
      rowFor(page, 'tree race note'),
      'an entry created while the tree was fetching must appear after the tree refetches',
    ).toBeVisible({ timeout: 30_000 });
    // And the original entry is still there — the fix may not rely on "just re-fetch the whole
    // tree and drop the existing state".
    await expect(rowFor(page, 'tree seed note')).toBeVisible();
  });
});

function rowFor(page: Page, title: string) {
  return page.locator('[data-testid^="wiki-row-"]').filter({ hasText: title }).first();
}

async function createWiki(page: Page, title: string): Promise<void> {
  await page.getByTestId('wiki-new-btn').click();
  await page.getByTestId('wiki-create-title').fill(title);
  await page.getByTestId('wiki-create-body').fill('a note in the tree');
  await page.getByTestId('wiki-create-submit').click();
}
