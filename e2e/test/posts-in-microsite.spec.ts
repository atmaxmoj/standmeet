// posts-in-microsite.spec.ts —— posts-tests.md § J: the SDK timeline <Posts /> (+ usePosts) on an
// owner microsite and on the home microsite, as a reader sees it.
//
//   - an empty timeline shows its empty state (in the page's <html lang>), not a blank box;
//   - anonymous: the public post only; a `hiring` code: also the two hiring posts; never the private
//     one. Each absence sits beside presence in the same view (the posts the reader may see);
//   - no visibility badge is shown to a visitor;
//   - times are absolute and in the reader's timezone (two browser timezones, one post);
//   - styled by the SDK's own stylesheet: read as computed style, never as class names.
// Contract (testids, SDK names, the page source): fixtures/posts-ui.ts.

import { test, expect } from '@/fixtures/test';
import type { Browser, Page } from '@playwright/test';

import { findCode } from '@/fixtures/codes';
import { bindCodeToPage, publishPage, setPageOpenWithoutCode } from '@/fixtures/microsite-rig';
import { enterCodeSession, openHome, openReader } from '@/fixtures/navigate';
import { seedMatrix, setupPostsOwner, type PostsOwner, type Seeded } from '@/fixtures/posts';
import { POSTS_PAGE, timelineItems } from '@/fixtures/posts-ui';

const SLUG = 'feed';
const CJK = /[一-鿿]/;

let o: PostsOwner;
let s: Seeded;

test.describe.configure({ mode: 'serial', timeout: 300_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(900_000);
  o = await setupPostsOwner(playwright, 'postsms');
  await publishPage(o.request, o.csrf, SLUG, POSTS_PAGE);
  // An anonymous reader must be able to open the page at all: the timeline is what it then shows.
  await setPageOpenWithoutCode(o.request, o.csrf, SLUG, true);
  await publishPage(o.request, o.csrf, 'home', POSTS_PAGE, 300_000);
  const hiring = await findCode(o.request, o.csrf, o.codes.hiring);
  await bindCodeToPage(o.request, o.csrf, hiring.id, SLUG);
});

test.afterAll(async () => { await o.request.dispose(); });

// openFeed —— a fresh visitor browser on the feed page; `zh` seeds the stored page language.
async function openFeed(browser: Browser, opts: { zh?: boolean; timezoneId?: string } = {}): Promise<Page> {
  const ctx = await browser.newContext(opts.timezoneId ? { timezoneId: opts.timezoneId } : {});
  const page = await ctx.newPage();
  if (opts.zh) await page.addInitScript(() => { window.localStorage.setItem('sm-lang', 'zh'); });
  await openReader(page, `/p/${SLUG}`);
  await expect(page.locator('[data-sm="marker"]')).toBeVisible({ timeout: 30_000 });
  return page;
}

// expectTimeline —— exactly these markers among the shown posts, and the hook agrees on the count.
async function expectTimeline(page: Page, sees: (keyof Seeded['m'])[], who: string): Promise<void> {
  await expect(timelineItems(page), `${who}: how many posts`).toHaveCount(sees.length, { timeout: 30_000 });
  const text = await page.getByTestId('posts-widget').innerText();
  for (const k of ['priv', 'pub', 'hir', 'hirInv'] as const) {
    expect(text.includes(s.m[k]), `${who}: ${sees.includes(k) ? 'sees' : 'does NOT see'} ${k}`).toBe(sees.includes(k));
  }
  await expect(page.locator('[data-sm="hook-count"]'), `${who}: usePosts agrees`).toHaveText(String(sees.length));
  await expect(page.getByTestId('posts-widget').getByText(/^(private|public|roles)$/i), `${who}: no badge`)
    .toHaveCount(0);
}

test('an empty timeline shows its empty state, in the page language', async ({ browser }) => {
  const en = await openFeed(browser);
  const empty = en.getByTestId('posts-empty');
  await expect(empty, 'empty state, not a blank box').toBeVisible({ timeout: 30_000 });
  const enText = (await empty.innerText()).trim();
  expect(enText.length, 'the empty state says something').toBeGreaterThan(3);
  expect(enText, 'English page, English copy').not.toMatch(CJK);
  await en.context().close();

  const zh = await openFeed(browser, { zh: true });
  await expect(zh.getByTestId('posts-empty'), 'Chinese page, Chinese copy').toHaveText(CJK, { timeout: 30_000 });
  await zh.context().close();
});

test('anonymous sees the public post; a hiring code also sees the hiring posts', async ({ browser }) => {
  s = await seedMatrix(o);
  const anon = await openFeed(browser);
  await expectTimeline(anon, ['pub'], 'anonymous');
  await anon.context().close();

  const page = await (await browser.newContext()).newPage();
  await enterCodeSession(page, o.codes.hiring, 'Recruiter');
  await page.waitForURL(`**/p/${SLUG}**`, { timeout: 15_000 });
  await expectTimeline(page, ['pub', 'hir', 'hirInv'], 'hiring code');
  await page.context().close();
});

test('the home microsite shows the same public timeline', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await openHome(page);
  await expect(page.locator('[data-sm="marker"]'), 'the home microsite is live').toBeVisible({ timeout: 30_000 });
  await expectTimeline(page, ['pub'], 'home, anonymous');
  await page.context().close();
});

test('a post time is absolute and in the reader\'s timezone', async ({ browser }) => {
  const created = new Date(s.pub.created_at);
  const minute = String(created.getUTCMinutes()).padStart(2, '0');
  const shown: string[] = [];
  for (const timezoneId of ['Asia/Tokyo', 'America/Los_Angeles']) {
    const page = await openFeed(browser, { timezoneId });
    const time = page.getByTestId(`posts-item-${s.pub.id}`).getByTestId('posts-time');
    await expect(time).toBeVisible({ timeout: 30_000 });
    expect(Date.parse(await time.getAttribute('datetime') ?? ''), 'dateTime is the post time').toBe(created.getTime());
    const text = (await time.innerText()).trim();
    expect(text, `${timezoneId}: an absolute clock time (its minute shows)`).toContain(minute);
    shown.push(text);
    await page.context().close();
  }
  expect(shown[0], 'Tokyo and Los Angeles readers see different local times').not.toBe(shown[1]);
});

test('the timeline is styled by the SDK stylesheet: mono metadata, serif body', async ({ browser }) => {
  const page = await openFeed(browser);
  const item = page.getByTestId(`posts-item-${s.pub.id}`);
  await expect(item).toBeVisible({ timeout: 30_000 });
  const font = (testid: string) => item.getByTestId(testid).evaluate((el) => getComputedStyle(el).fontFamily.toLowerCase());
  expect(await font('posts-time'), 'the time is metadata: JetBrains Mono').toContain('jetbrains mono');
  expect(await font('posts-body'), 'the body is prose: Newsreader').toContain('newsreader');
  await page.context().close();
});
