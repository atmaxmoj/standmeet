// wiki-reader-shell-persists.spec.ts — switching to another entry: **the shell must
// not remount**; scrolling the body: **the shell must not move**.
//
// The field case (prod): clicking another entry in the tree makes the whole tree
// flash and re-render; scrolling down through the body drags the top bar and the
// tree along with it.
//
// Both share the same cause: the top bar and the tree are written **inside**
// `wiki/page.tsx` and `wiki/[...path]/page.tsx` respectively. Next.js preserves the
// layout and swaps only the page when navigating between sibling pages — but those
// two elements live inside the page, so every click on an entry remounts the entire
// shell (the tree re-renders, every level re-fetches), and all three sit in the same
// scroll flow.
// (`admin` has long been a layout, so switching sections there doesn't flash its
// sidebar. Same structure, but wiki has never had it.)
//
// Neither criterion looks at styling — both look at **behavior**:
//
//   ① No remount — attach an expando property to the tree's real DOM node (React
//      never touches it); after switching entries, it should still be there. If the
//      node was rebuilt, the property is gone. This is stronger than "the expanded
//      state is still there": the latter can be restored from a store, looking the
//      same while the shell still remounted underneath
//      ([[assertion-that-cannot-fail]]'s neighbor: the criterion must be able to
//      tell "didn't remount" apart from "remounted but looks the same").
//
//   ② Each scrolls on its own — scroll the body column, and the top bar's position
//      in the viewport must not move at all.
//      First assert that the body actually scrolled, otherwise "the top bar didn't
//      move" would be vacuously true on a page that can't scroll at all.
//
// RED (before the fix): ① the property is lost (the shell inside the page
// remounted); ② the top bar moves along with the body.

import { test, expect, type Page } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { publishEntry, seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'reader-shell@example.com',
  password: 'the-shell-outlives-the-page-1',
  handle: 'shellowner',
  fullName: 'Shell Owner',
};

const FIRST = { title: 'First entry', path: 'first-entry' };
const SECOND = { title: 'Second entry', path: 'second-entry' };
// The body must be long enough to actually scroll — criterion ② would be vacuously
// true on a page that can't scroll.
const LONG_BODY = Array.from({ length: 120 },
  (_, i) => `Paragraph ${i + 1}. The reader scrolls this column and the shell stays put.`
).join('\n\n');

test.describe.configure({ timeout: 180_000 });

test.describe('wiki 阅读器外壳：换文章不重挂，读正文不跟着滚', () => {
  test.beforeAll(async ({ playwright }) => {
    // `describe.configure({ timeout })` only governs the test body, **it does not
    // reach the hook** — the hook has its own default of 30s. Seeding two long
    // entries requires resetting the instance + claiming + creating and publishing
    // two entries, which can hit that limit, and the red would then show up on the
    // hook, looking like a product problem ([[red-in-the-wrong-place]]).
    test.setTimeout(180_000);
    await seedTwoEntries(playwright);
  });

  test('换一篇文章，树这个 DOM 节点没有被重建', async ({ page }) => {
    // the tree rail is display:none below 1500px (reader-shell design c215f0be).
    await page.setViewportSize({ width: 1512, height: 900 });
    await goto(page, `/wiki/${FIRST.path}`);
    await expect(page.getByTestId('wiki-toc')).toBeVisible({ timeout: 15_000 });

    // An expando property: React never touches it, it survives as long as the node
    // does, and disappears the moment the node is rebuilt.
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="wiki-toc"]');
      (el as unknown as Record<string, unknown>)['__shellProbe'] = 1;
    });

    // Click another entry from the tree — exactly the action a reader takes to
    // switch entries.
    await page.getByTestId(`tree-node-${SECOND.path}`).getByRole('link').first().click();
    await page.waitForURL(new RegExp(`/wiki/${SECOND.path}$`));
    await expect(page.getByTestId('wiki-body'), '真的换到了第二篇')
      .toContainText('Paragraph 1.', { timeout: 15_000 });

    const survived = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="wiki-toc"]');
      return (el as unknown as Record<string, unknown>)['__shellProbe'];
    });
    expect(survived, '树被重建了 —— 换文章时整个外壳重挂了一遍').toBe(1);
  });

  test('滚正文，顶栏留在原地', async ({ page }) => {
    await goto(page, `/wiki/${SECOND.path}`);
    await expect(page.getByTestId('wiki-body')).toBeVisible({ timeout: 15_000 });

    const before = await shellTop(page);
    const moved = await scrollArticle(page);
    expect(moved, '正文真的滚动了，否则下面那条是恒真的').toBeGreaterThan(100);

    expect(await shellTop(page), '顶栏跟着正文一起滚走了').toBe(before);
  });
});

// shellTop — the top bar's position within the **viewport**. If the shell is fixed,
// scrolling the body does not change it.
async function shellTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const bar = document.querySelector('[data-testid="wiki-topbar"]');
    return bar ? Math.round(bar.getBoundingClientRect().top) : -1;
  });
}

// scrollArticle — scrolls the body column (its own scroll container; falls back to
// window scrolling so this can still be driven **before the fix** too), and returns
// how far the body actually moved.
async function scrollArticle(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const body = document.querySelector('[data-testid="wiki-body"]');
    const before = body!.getBoundingClientRect().top;
    const col = document.querySelector('[data-testid="wiki-scroll"]');
    if (col && col.scrollHeight > col.clientHeight) col.scrollTop = 600;
    else window.scrollTo(0, 600);
    // Wait for **the scroll itself** to happen (a scroll event), not for a fixed
    // number of milliseconds.
    await new Promise<void>((resolve) => {
      const target: EventTarget = col ?? window;
      const done = (): void => { target.removeEventListener('scroll', done); resolve(); };
      target.addEventListener('scroll', done, { once: true });
      // Also handle the case where it's already scrolled into place and no event
      // will ever arrive: reading the current position once tells us that.
      if (Math.abs(before - body!.getBoundingClientRect().top) > 0) done();
    });
    return Math.abs(before - body!.getBoundingClientRect().top);
  });
}

async function seedTwoEntries(playwright: Playwright): Promise<void> {
  resetInstance();
  const request: APIRequestContext = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'reader-shell-seed');
  const sid = await initMCP(request, token);
  for (const e of [FIRST, SECOND]) {
    const { wikiID } = await seedWiki(request, token, sid, {
      body: LONG_BODY, title: e.title, path: e.path,
    });
    await publishEntry(request, token, sid, { genre: 'wiki', id: wikiID });
  }
  await request.dispose();
}
