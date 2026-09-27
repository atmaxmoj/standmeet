// monitor-sessions-feed-tabs.spec.ts — BLACK BOX. The traffic panel was one long scroll: the
// per-session table AND the event feed stacked on a single page under the time-window selector
// (owner, 2026-09-11: "会话和时间放一页上太长了 … 时间选择那个 tag 上再有 tag … 做一下分页").
//
// This asserts the restructure, driven only through the owner's real admin UI:
//   1. The window selector carries a SECOND row of tabs (feed / sessions). Only the active view
//      renders — the feed and the sessions table are never on screen together.
//   2. Each view PAGINATES: a window with more than one page of rows shows the first page plus a
//      "load more" control that appends the next page from the server (docs/design/paging.md; the
//      prev/next pager over one fetched window became the shared server-side paginator).
//
// Real seeding only: visits come from real visitor browsers (a distinct browser context = a
// distinct session; each read = a feed event), never injected through the events/sessions API — a
// panel that groups and pages traffic must be shown real traffic.
//
// RED before the restructure: there are no `monitor-tab-*` controls, the feed and sessions render
// together (both visible at once), and neither view has a pager, so every assertion below fails.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki, publishEntry } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { openVisitorBrowser } from '@/fixtures/visitor-browser';

// PAGE_SIZE — the panel's rows-per-page (MONITOR_PAGE_SIZE in use-monitor). The pagination case
// seeds one more than this so a second page must exist.
const PAGE_SIZE = 20;

const OWNER = {
  email: 'monitor-tabs@example.com', password: 'correct-horse-battery-staple',
  handle: 'monitortabs', fullName: 'Monitor Tabs Owner',
};
const ENTRY = { title: 'Tabbed Traffic', path: 'tabbed-traffic' };

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('monitor · sessions and the feed are separate tabs, each paginated', () => {
  test.beforeAll(async ({ playwright }) => { await initOwnerWithEntry(playwright); });

  test('the window selector has feed/sessions sub-tabs; only the active view renders', async ({
    adminPage: page, playwright,
  }) => {
    test.setTimeout(120_000);
    // One real visitor read: enough that both the feed and the sessions view have content to show.
    const ctx = await openVisitorBrowser(playwright, {});
    await ctx.read(`/wiki/${ENTRY.path}`);
    await ctx.dispose();

    await gotoAdminSection(page, 'monitor');

    // The window (time-range) control still governs both views.
    await expect(page.getByTestId('monitor-window'), 'the time-window selector is present')
      .toBeVisible({ timeout: 20_000 });

    // A second row of tabs picks which view is shown.
    const feedTab = page.getByTestId('monitor-tab-feed');
    const sessionsTab = page.getByTestId('monitor-tab-sessions');
    await expect(feedTab, 'a feed tab').toBeVisible();
    await expect(sessionsTab, 'a sessions tab').toBeVisible();

    // Default view: the feed. The sessions table is NOT on the same page.
    await expect(page.getByTestId('monitor-feed'), 'feed shows by default').toBeVisible();
    await expect(page.getByTestId('monitor-sessions'), 'sessions is not stacked under the feed')
      .toBeHidden();

    // Switch to sessions: now the sessions table shows and the feed is gone — not both at once.
    await sessionsTab.click();
    await expect(page.getByTestId('monitor-sessions'), 'sessions shows on its own tab').toBeVisible();
    await expect(page.getByTestId('monitor-feed'), 'the feed is not also on the sessions tab')
      .toBeHidden();

    // ...and back.
    await feedTab.click();
    await expect(page.getByTestId('monitor-feed'), 'the feed comes back').toBeVisible();
    await expect(page.getByTestId('monitor-sessions'), 'sessions is hidden again').toBeHidden();
  });

  test('the feed pages on the server: PAGE_SIZE rows, then load more brings new ones', async ({
    adminPage: page, playwright,
  }) => {
    test.setTimeout(180_000);
    // One visitor reading the page PAGE_SIZE+1 times makes PAGE_SIZE+1 feed events (one viewer, so
    // the sessions view stays short — this case is about the feed's own paging).
    const ctx = await openVisitorBrowser(playwright, {});
    for (let i = 0; i < PAGE_SIZE + 1; i += 1) {
      await ctx.read(`/wiki/${ENTRY.path}`);
    }
    await ctx.dispose();

    await gotoAdminSection(page, 'monitor');
    await expect(page.getByTestId('monitor-feed'), 'feed view').toBeVisible({ timeout: 20_000 });

    // Page one: exactly PAGE_SIZE rows, and a load-more control because more exist.
    await expect(page.getByTestId('monitor-row'), 'first page is full at PAGE_SIZE rows')
      .toHaveCount(PAGE_SIZE);
    const more = page.getByTestId('monitor-feed-load-more');
    await expect(more, 'load more appears when a second page exists').toBeVisible();
    const firstPageIds = await page.getByTestId('monitor-row').evaluateAll(
      (els) => els.map((e) => e.getAttribute('data-row-id')),
    );

    await more.click();
    // The next page is appended: more rows than before, every id distinct (no row shown twice).
    await expect.poll(() => page.getByTestId('monitor-row').count()).toBeGreaterThan(PAGE_SIZE);
    const allIds = await page.getByTestId('monitor-row').evaluateAll(
      (els) => els.map((e) => e.getAttribute('data-row-id')),
    );
    expect(new Set(allIds).size, 'no row appears twice').toBe(allIds.length);
    expect(allIds.slice(0, PAGE_SIZE), 'page one stays in place').toEqual(firstPageIds);
  });
});

async function initOwnerWithEntry(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password, handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'monitor-tabs-seed');
  const sid = await initMCP(request, token);
  const { wikiID: id } = await seedWiki(request, token, sid, {
    title: ENTRY.title, body: 'A note read many times to fill the feed.', path: ENTRY.path,
  });
  await publishEntry(request, token, sid, { genre: 'wiki', id });
  await request.dispose();
}
