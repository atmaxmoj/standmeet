// monitor-reader-interactions.spec.ts —— the beacon events a REAL page actually emits.
//
// The beacon spec next door proves the endpoint accepts these names. That is a different claim
// from "the product sends them", and for eleven of them it was true while nothing on any page
// emitted a single one: the backend was instrumented and the browser was silent, which reads on
// the panel exactly like "nobody clicked anything" ([[test-covers-capability-not-face]]).
//
// So nothing here posts a beacon. Every test drives the real reader in a browser, clicks the real
// control, and then reads the row back through the admin API. A control that stops emitting —
// because a testid was renamed, a listener was dropped, or the tracker was never mounted on a
// page — takes its test red with it.
//
// The browser is HeadlessChrome, which the bot filter correctly classifies as a crawler, so every
// read here passes include_bots. That is the harness being honest about what it is, not the
// product misfiling a person.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki, publishEntry } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';
import { readEvents } from '@/fixtures/monitor';
import type { MonitorEvent } from '@/fixtures/monitor';

const OWNER = {
  email: 'monitor-interactions@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'monitorinteractions',
  fullName: 'Monitor Interactions',
};

// A→B by wikilink: A's "read next" rail carries B, and B's "cited by" rail carries A. The two
// rails are the same component with different data, so testing only one would leave the other's
// rule free to point at the wrong testid forever.
const TARGET = { title: 'Storage Target', path: 'storage-target' };
const SOURCE = { title: 'Storage Source', path: 'storage-source' };

// A note in two languages, so the language switcher renders at all: it hides itself on a note
// with one language, and a hidden control emits nothing.
const MULTILINGUAL = { title: 'Two Tongues', path: 'two-tongues' };
const MULTILINGUAL_BODY = [
  '> [!i18n]',
  '> > [!lang] en',
  '> > The English half of this note.',
  '>',
  '> > [!lang] zh',
  '> > 这条笔记的中文部分。',
].join('\n');

// A published long-form writing: the writings reader is a second page sharing the same reader
// component, and a tracker mounted on only one of the two passes every corpus-reader test.
const WRITING = { slug: 'monitor-writing', title: 'A Long Writing' };

// An entry read by exactly one test — the once-per-page count below is meaningless if another
// test in this file also scrolls the page it counts.
const ONCE = { title: 'Read Once', path: 'read-once' };

// A body long enough to actually scroll. Scroll depth reports nothing on a page with no
// scrollbar, which is correct behaviour and useless as a fixture.
const LONG_BODY = Array.from(
  { length: 120 },
  (_, i) => `Paragraph ${i}: the write path amplifies, and the read path pays for it.`,
).join('\n\n');

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(180_000);
  await seedReaderCorpus(playwright);
});

test.describe('monitor · the links a reader takes', () => {
  test('opening a related entry emits related_click, naming where it went', async (
    { page, request },
  ) => {
    await goto(page, `/wiki/${SOURCE.path}`);
    const rail = page.getByTestId('related-rail-read-next');
    await expect(rail).toBeVisible({ timeout: 20_000 });
    await rail.getByRole('link').first().click();

    const row = await eventRow(request, 'related_click');
    expect(row, 'clicking a "read next" link must be recorded').toBeTruthy();
    // Which link, not just that one was clicked. "People leave this entry" is a fact about the
    // entry; "people leave this entry FOR that one" is a fact about the corpus.
    expect(row?.props['to']).toBe(`/wiki/${TARGET.path}`);
    expect(row?.surface).toBe('reader');
  });

  test('opening a citing entry emits cited_by_click, not related_click', async (
    { page, request },
  ) => {
    await goto(page, `/wiki/${TARGET.path}`);
    const rail = page.getByTestId('related-rail-cited-by');
    await expect(rail).toBeVisible({ timeout: 20_000 });
    await rail.getByRole('link').first().click();

    const row = await eventRow(request, 'cited_by_click');
    expect(row, 'clicking a "cited by" link must be recorded').toBeTruthy();
    // The two rails sit next to each other and render identically. A rule matching the wrong one
    // would file every backlink click as an outbound one, and both counts would still look alive.
    expect(row?.props['to']).toBe(`/wiki/${SOURCE.path}`);
  });

  test('expanding a tree node emits tree_expand, and collapsing it does not', async (
    { page, request },
  ) => {
    // The tree rail only renders at ≥1500px: below that the left margin is too narrow for an
    // indented tree, and it is hidden on purpose (app/src/app/wiki/wiki-shell.module.css). The
    // default 1280 viewport therefore has no tree to expand — a harness fact, not a product one.
    await page.setViewportSize({ width: 1600, height: 900 });
    await goto(page, `/wiki/${TARGET.path}`);
    const toggle = page.getByTestId('tree-toggle-storage-source').first();
    await expect(toggle).toBeVisible({ timeout: 20_000 });

    await toggle.click(); // expand
    const opened = await eventRow(request, 'tree_expand');
    expect(opened, 'expanding a branch must be recorded').toBeTruthy();
    expect(opened?.props['path']).toBe(SOURCE.path);

    // Collapse, then expand again. The second expand is the BARRIER: waiting for its row to
    // arrive proves the collapse's beacon had every chance to arrive first, without a sleep
    // standing in for that proof. Three clicks, two expands — a rule that counted collapses too
    // would leave three rows here.
    await toggle.click(); // collapse
    await toggle.click(); // expand again
    await expect.poll(
      () => countOf(request, 'tree_expand'), { timeout: 15_000, intervals: [500] },
    ).toBe(2);
    // Collapsing is not interest in a branch. Counting both makes "which branches get opened" a
    // count of fidgeting, which is always high and never means anything.
    expect(await countOf(request, 'tree_expand'), 'a collapse is not an expand').toBe(2);
  });

});

test.describe('monitor · how far a reader got', () => {
  test('reaching the end of a long entry emits scroll_depth and read_complete', async (
    { page, request },
  ) => {
    await goto(page, `/wiki/${TARGET.path}`);
    await expect(page.getByTestId('wiki-body')).toBeVisible({ timeout: 20_000 });
    await readToTheEnd(page, request, 'reader', `/wiki/${TARGET.path}`);

    // Asserted on the SET of rows, not on the newest one. Four thresholds cross in a single
    // scroll event, all four beacons leave together, and rows written in the same instant have
    // no defined order — `rows[0]` is whichever one the database happened to land first, which
    // is a coin toss dressed up as an assertion.
    const rows = await scrollRows(request, 'reader', `/wiki/${TARGET.path}`);
    expect(rows.every((r) => r.entity_kind === 'wiki'), 'each row names the entry').toBe(true);

    // Two events, not one. "Scrolled to the bottom" and "finished reading" are the same gesture
    // and different questions: the first belongs on a depth histogram, the second on the list of
    // entries people actually finish.
    const done = await eventRow(request, 'read_complete');
    expect(done, 'reaching the end must be reported').toBeTruthy();
    expect(done?.surface).toBe('reader');
  });

  test('each threshold is reported once per page, however much the reader scrolls', async (
    { page, request },
  ) => {
    // Its own entry, read by no other test in this file: the count below is then a fact about
    // this page rather than about everything the file has scrolled.
    const path = `/wiki/${ONCE.path}`;
    await goto(page, path);
    await expect(page.getByTestId('wiki-body')).toBeVisible({ timeout: 20_000 });
    await readToTheEnd(page, request, 'reader', path);
    const settled = (await scrollRows(request, 'reader', path)).length;

    // Read it again, top to bottom.
    await scrollToTop(page);
    await scrollToEnd(page);
    // The BARRIER: hiding the page reports the dwell, and waiting for THAT row proves any scroll
    // beacon had its chance to arrive first. A sleep here would be guessing at the same thing.
    // The dwell only reports above the two-second bounce floor, so the page has to have been
    // open that long for the barrier to exist at all.
    await stayAtLeast(page, 2500);
    await hidePage(page);
    await eventRow(request, 'read_dwell');

    // A scroll bar dragged up and down is one reader, not twenty, and a depth histogram that
    // says otherwise is worse than no histogram — it makes fidgeting look like engagement.
    expect(await scrollRows(request, 'reader', path), 'a second pass adds nothing')
      .toHaveLength(settled);
  });

  test('leaving a page emits read_dwell, bucketed rather than timed', async (
    { page, request },
  ) => {
    await goto(page, `/wiki/${TARGET.path}`);
    await expect(page.getByTestId('wiki-body')).toBeVisible({ timeout: 20_000 });
    await stayAtLeast(page, 2500);
    await hidePage(page);

    const row = await eventRow(request, 'read_dwell');
    expect(row, 'leaving the page must report how long the visitor stayed').toBeTruthy();
    // A bucket, not a stopwatch reading. The owner asks "did they actually read it"; a
    // per-visitor second count answers a question nobody asked and identifies more than it tells.
    expect(['2-10s', '10-30s', '30s-2m', '2m+']).toContain(row?.props['dwell']);
  });

  test('switching language emits lang_switch, naming the language', async (
    { page, request },
  ) => {
    await goto(page, `/wiki/${MULTILINGUAL.path}`);
    // Located by hrefLang, which is how a reader's browser recognises it too. The visible label
    // is the owner's, and a test keyed on it would break on a note that spells its languages
    // differently.
    const zh = page.locator('[data-testid="language-switch"] a[hreflang="zh"]');
    await expect(zh).toBeVisible({ timeout: 20_000 });
    await zh.click();

    const row = await eventRow(request, 'lang_switch');
    expect(row, 'switching language must be recorded').toBeTruthy();
    // Which language, because that is the whole question: an owner writing in two languages
    // wants to know whether the second one is read at all.
    expect(row?.props['lang']).toBe('zh');
  });

  test('the writings reader reports on its own surface, not the corpus one', async (
    { page, request },
  ) => {
    await goto(page, `/writings/${WRITING.slug}`);
    await expect(page.getByTestId('writing-page')).toBeVisible({ timeout: 20_000 });
    await readToTheEnd(page, request, 'writings');

    // Two pages share one reader component, and a tracker mounted on only one of them passes
    // every test above. This is the only assertion that can tell them apart — and the two shells
    // scroll differently (the corpus reader scrolls an inner column, the writings page scrolls
    // the document), so it is not a formality.
    expect((await scrollRows(request, 'writings')).length, 'the writings reader reports')
      .toBeGreaterThan(0);
  });
});

// eventRow —— the newest row for one event name, waited for.
//
// A poll rather than a sleep: sendBeacon is fire-and-forget, so the click returns before the row
// exists, and a fixed wait either flakes or is slow enough to make the suite unpleasant.
async function eventRow(
  request: APIRequestContext, name: string,
): Promise<MonitorEvent | undefined> {
  let found: MonitorEvent | undefined;
  await expect.poll(async () => {
    const rows = await readEvents(request, OWNER, { event: name, include_bots: true });
    found = rows[0];
    return rows.length;
  }, { timeout: 15_000, intervals: [500] }).toBeGreaterThan(0);
  return found;
}

// scrollRows —— the scroll_depth rows recorded on one surface.
async function scrollRows(
  request: APIRequestContext, surface: string, path = '',
): Promise<MonitorEvent[]> {
  const rows = await readEvents(request, OWNER, {
    event: 'scroll_depth', include_bots: true, limit: 1000,
  });
  // Scoped to one PAGE when a path is given. The instance is shared across this file's tests,
  // so "how many depth rows exist" is a statement about the whole file; "how many exist for this
  // entry" is a statement about the page under test.
  return rows.filter((r) => r.surface === surface && (path === '' || r.url_path === path));
}

// readToTheEnd —— scroll to the bottom until the depth actually lands.
//
// Re-scrolls on each attempt because the page is server-rendered: the article is on screen and
// readable before React has hydrated, so a scroll fired the instant it is visible can reach a
// page whose listener does not exist yet. That is real — a visitor who scrolls in the first
// moments loses those thresholds — and it is not what these tests are about, so the harness
// scrolls again rather than pretending the first one counted. Once the listener exists, each
// threshold still fires exactly once: the top-then-bottom cycle is what gives a freshly mounted
// listener a scroll event to hear.
async function readToTheEnd(
  page: Page, request: APIRequestContext, surface: string, path = '',
): Promise<void> {
  await expect.poll(async () => {
    const rows = await scrollRows(request, surface, path);
    // Only scroll again while NOTHING has landed. Once the first batch is in, the listener
    // exists and further scrolling is just noise: each threshold fires once per page, so a
    // second cycle sends nothing and a third would only make the count harder to read.
    if (rows.length === 0) {
      await scrollToTop(page);
      await scrollToEnd(page);
    }
    return [...new Set(rows.map((r) => r.props['depth']))].sort().join(',');
  }, { timeout: 30_000, intervals: [1000] }).toBe('100,25,50,75');
}

async function countOf(request: APIRequestContext, name: string): Promise<number> {
  const rows = await readEvents(request, OWNER, {
    event: name, include_bots: true, limit: 1000,
  });
  return rows.length;
}

// scrollToTop —— put every scroller back to the top, so the next jump produces a scroll event
// even for a listener that has just mounted.
async function scrollToTop(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    for (let el = document.querySelector('main'); el !== null; el = el.parentElement) {
      el.scrollTop = 0;
    }
  });
}

// scrollToEnd —— jump to the bottom. One scroll event is enough: the watcher reports every
// threshold at or below the depth it sees, so a single jump fires 25/50/75/100 together.
async function scrollToEnd(page: Page): Promise<void> {
  // Scrolls whatever the READER's wheel would scroll: the document if it moves, otherwise the
  // nearest scrollable ancestor of the article. The corpus reader's shell is `h-dvh
  // overflow-hidden` with the body in an inner column, so a test that only moved `window` would
  // scroll nothing and report "the product does not emit scroll depth" — which was true for a
  // different reason, and is the defect this helper was written against.
  await page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollHeight > doc.clientHeight) {
      window.scrollTo(0, doc.scrollHeight);
      return;
    }
    for (let el = document.querySelector('main'); el !== null; el = el.parentElement) {
      if (el.scrollHeight > el.clientHeight) {
        el.scrollTop = el.scrollHeight;
        return;
      }
    }
  });
  // No sleep. One scroll event crosses all four thresholds at once (the watcher reports every
  // unseen mark at or below the depth it observes), and the caller's poll on the recorded ROW is
  // what waits for delivery.
  await page.waitForFunction(() => {
    const doc = document.documentElement;
    if (doc.scrollTop > 0) return true;
    for (let el = document.querySelector('main'); el !== null; el = el.parentElement) {
      if (el.scrollTop > 0) return true;
    }
    return false;
  });
}

// stayAtLeast —— wait until the page has genuinely been open this long.
//
// The dwell floor is two seconds of REAL time on the page: under it, a mis-click would be filed
// as a read. So the condition waited for is the page's own elapsed time, read from the page,
// rather than a sleep standing in for it.
async function stayAtLeast(page: Page, ms: number): Promise<void> {
  await expect.poll(
    () => page.evaluate(() => performance.now()),
    { timeout: 15_000, intervals: [250] },
  ).toBeGreaterThan(ms);
}

// hidePage —— what a visitor closing the tab looks like to the page. `visibilitychange` is what
// the dwell watcher listens for, because mobile browsers routinely never fire beforeunload.
async function hidePage(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true, get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

async function seedReaderCorpus(playwright: Playwright): Promise<void> {
  resetInstance();
  const request: APIRequestContext = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'monitor-interactions-seed');
  const sid = await initMCP(request, token);
  // B first, so A's [[…]] can resolve to it.
  const target = await seedWiki(request, token, sid, {
    title: TARGET.title, body: LONG_BODY, path: TARGET.path,
  });
  const source = await seedWiki(request, token, sid, {
    title: SOURCE.title,
    body: `Everything below follows from [[${TARGET.title}]].\n\n${LONG_BODY}`,
    path: SOURCE.path,
  });
  await publishEntry(request, token, sid, { genre: 'wiki', id: target.wikiID });
  await publishEntry(request, token, sid, { genre: 'wiki', id: source.wikiID });
  // A child under SOURCE, so the tree has a branch worth expanding.
  const child = await callTool<{ id: string }>(request, token, sid, 'corpus.create', {
    genre: 'raw', body: 'A leaf under the source.', source: 'mcp:e2e', tags: [],
  });
  const leaf = await callTool<{ id: string }>(request, token, sid, 'corpus.promote', {
    genre: 'raw', id: child.id, title: 'Source Leaf', parent_id: source.wikiID,
  });
  await publishEntry(request, token, sid, { genre: 'wiki', id: leaf.id });
  const once = await seedWiki(request, token, sid, {
    title: ONCE.title, body: LONG_BODY, path: ONCE.path,
  });
  await publishEntry(request, token, sid, { genre: 'wiki', id: once.wikiID });
  const bilingual = await seedWiki(request, token, sid, {
    title: MULTILINGUAL.title, body: MULTILINGUAL_BODY, path: MULTILINGUAL.path,
  });
  await publishEntry(request, token, sid, { genre: 'wiki', id: bilingual.wikiID });
  await callTool(request, token, sid, 'writing_create', {
    slug: WRITING.slug, title: WRITING.title,
    excerpt: 'Long enough to scroll to the end of.',
    body_md: LONG_BODY, publish: true, tags: [],
  });
  await request.dispose();
}
