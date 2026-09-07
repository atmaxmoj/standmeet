// monitor-window.spec.ts —— the three spans the panel offers, and the retention behind them.
//
// A window is only real if something falls OUTSIDE it. Every assertion here therefore ages a
// recorded row backwards first (execSQL — there is no "wind the clock back" endpoint, nor should
// there be) and then asks whether each window can still see it. Without the ageing, every window
// returns the same fresh rows and all three assertions pass whatever the SQL does — a green that
// carries no information ([[assertion-that-cannot-fail]]).
//
// The row is aged rather than the clock moved, because the cutoff is computed in Go from
// time.Now(): moving the container's clock would test the container, and moving the row tests the
// query.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki, publishEntry } from '@/fixtures/corpus';
import { resetInstance, findSetupToken, execSQL } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { readEvents, readSummary, visitAsStranger } from '@/fixtures/monitor';

const OWNER = {
  email: 'monitor-window@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'monitorwindow',
  fullName: 'Monitor Window',
};

// Three entries, each aged to a different depth, so one read of the feed answers all three
// windows at once and the three answers can be compared against each other.
const RECENT = { title: 'Window Recent', path: 'window-recent', ageDays: 0 };
const MIDDLE = { title: 'Window Middle', path: 'window-middle', ageDays: 20 };
const OLD = { title: 'Window Old', path: 'window-old', ageDays: 60 };
const ANCIENT = { title: 'Window Ancient', path: 'window-ancient', ageDays: 200 };

const ALL = [RECENT, MIDDLE, OLD, ANCIENT];

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('monitor windows · 7 days / 28 days / 3 months', () => {
  test.beforeAll(async ({ playwright }) => {
    await seedAgedTraffic(playwright);
  });

  test('the default window is 28 days, and it does not reach further back', async (
    { request },
  ) => {
    const paths = await pathsIn(request, {});

    // What an owner sees on opening the panel, with nothing selected.
    expect(paths, 'today').toContain(`/wiki/${RECENT.path}`);
    expect(paths, '20 days ago').toContain(`/wiki/${MIDDLE.path}`);
    expect(paths, '60 days ago is outside 28 days').not.toContain(`/wiki/${OLD.path}`);
  });

  test('7 days sees only the last week', async ({ request }) => {
    const paths = await pathsIn(request, { window: '7d' });

    expect(paths).toContain(`/wiki/${RECENT.path}`);
    // The whole point of the narrow window: 20 days ago is inside 28 and outside 7, so this is
    // the one assertion that can tell the two windows apart at all.
    expect(paths, '20 days ago is outside 7 days').not.toContain(`/wiki/${MIDDLE.path}`);
  });

  test('3 months reaches back to the retention limit and no further', async ({ request }) => {
    const paths = await pathsIn(request, { window: '90d' });

    expect(paths, '60 days ago is inside 3 months').toContain(`/wiki/${OLD.path}`);
    // Nothing older than the window is kept, so there is nothing older to show. A window that
    // reached past retention would show a span that is empty by construction and read as "you
    // had no visitors then".
    expect(paths, '200 days ago is past retention').not.toContain(`/wiki/${ANCIENT.path}`);
  });

  test('an unknown window name falls back to the default rather than erroring', async (
    { request },
  ) => {
    const paths = await pathsIn(request, { window: 'last-tuesday' });

    // A stale bookmark carrying an old window name must still show the owner their traffic.
    expect(paths).toContain(`/wiki/${RECENT.path}`);
    expect(paths).not.toContain(`/wiki/${OLD.path}`);
  });

  test('the summary is counted over the same span as the feed', async ({ request }) => {
    const week = await readSummary(request, OWNER, '7d');
    const quarter = await readSummary(request, OWNER, '90d');

    // If the summary ignored its window, these two reads would be identical — which is exactly
    // the panel printing one span's numbers over another span's rows, with nothing on screen
    // saying so.
    expect(quarter.views).toBeGreaterThan(week.views);
    // And the pair agrees: what the wide summary counts extra is what the wide feed shows extra.
    const weekPaths = await pathsIn(request, { window: '7d' });
    const quarterPaths = await pathsIn(request, { window: '90d' });
    expect(quarterPaths.length - weekPaths.length).toBe(quarter.views - week.views);
  });
});

// pathsIn —— the url paths recorded inside one window.
async function pathsIn(
  request: APIRequestContext, filter: { window?: string },
): Promise<string[]> {
  const rows = await readEvents(request, OWNER, { ...filter, limit: 1000 });
  return rows.map((r) => r.url_path);
}

// seedAgedTraffic —— one recorded read per entry, each backdated to its own depth.
//
// The read is real (a stranger hits the reader route and the middleware records it); only the
// timestamp is manufactured. Recording the row by hand would test the SQL against a row this
// system never writes.
async function seedAgedTraffic(playwright: Playwright): Promise<void> {
  resetInstance();
  const request: APIRequestContext = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'monitor-window-seed');
  const sid = await initMCP(request, token);
  for (const entry of ALL) {
    const { wikiID } = await seedWiki(request, token, sid, {
      title: entry.title, body: `Traffic from ${entry.ageDays} days ago.`, path: entry.path,
    });
    await publishEntry(request, token, sid, { genre: 'wiki', id: wikiID });
    await visitAsStranger(playwright, `/api/v1/wiki/${entry.path}`);
    age(entry.path, entry.ageDays);
  }
  await request.dispose();
}

// age —— push one entry's recorded rows back in time.
function age(path: string, days: number): void {
  if (days === 0) return;
  execSQL(
    `UPDATE visit_event SET created_at = created_at - interval '${days} days' `
    + `WHERE url_path = '/wiki/${path}'`,
  );
}
