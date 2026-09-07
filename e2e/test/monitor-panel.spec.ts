// monitor-panel.spec.ts —— settings → monitor: the owner can SEE their traffic.
//
// The read path already has coverage through the API (monitor-records-a-reader-view.spec.ts).
// This file exists because that coverage stays green when there is no screen at all: an e2e
// that only calls the endpoint cannot tell "the panel shows the number" from "the panel was
// never built". So every assertion here goes through the rendered page.
//
// The numbers asserted are the ones the fixture produced, not "some number rendered" — a panel
// showing a hardcoded value passes the second and fails the first.

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki, publishEntry } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { HUMAN_UA } from '@/fixtures/monitor';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'monitor-panel@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'monitorpanel',
  fullName: 'Monitor Panel',
};

// The public path is TREE-DERIVED from the slugified title (corpus WikiMetaTreePaths), not from
// the `path` argument seedWiki takes. Getting that wrong 404s, and a 404 is not recorded — the
// panel then reads zero and the failure looks like "recording is broken" instead of "the test
// asked for a page that does not exist". Keep the two in step deliberately.
const ENTRY = {
  title: 'Sleep And Memory Consolidation',
  path: 'sleep-and-memory-consolidation',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('monitor panel · settings → monitor shows real traffic', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwnerWithEntry(playwright);
  });

  test('the section is reachable from the settings group, translated', async ({ adminPage }) => {
    // No goto: the adminPage fixture already lands signed in on /admin, which is the known
    // entry point. Navigating by URL would skip whatever the shell does on the way in.
    const link = adminPage.getByTestId('admin-nav-monitor');
    await expect(link).toBeVisible();
    // A raw catalog key rendering as a label is the failure this catches: it looks like a
    // working nav until you read it.
    const label = (await link.innerText()).trim();
    expect(label).not.toBe('');
    expect(label).not.toContain('adminNav');
    expect(label).not.toContain('section.');
  });

  test('the summary renders numbers, not an error or a NaN', async ({ adminPage }) => {
    await openPanel(adminPage);
    await expect(adminPage.getByTestId('monitor-summary')).toBeVisible();
    // Every stat is a number. Not "0": the harness's own sign-in navigates the public root
    // before it holds an owner cookie, so those visits are legitimately recorded — asserting a
    // zero here would be asserting that the harness did nothing, which is not the product's
    // claim. What matters is that five numbers render and none of them is arithmetic debris.
    for (const id of ['viewers', 'visits', 'views', 'events', 'bots']) {
      await expect(adminPage.getByTestId(`stat-${id}-value`)).toHaveText(/^\d+$/);
    }
    const body = await adminPage.locator('body').innerText();
    expect(body).not.toContain('NaN');
    expect(body).not.toContain('undefined');
  });

  test("the owner's own reading is not counted", async ({ adminPage }) => {
    // `adminPage.request` shares the signed-in page's cookie jar — this is genuinely the owner's
    // browser reading their own site, and it must leave every number alone. Otherwise an owner
    // proof-reading their corpus invents an audience for themselves.
    //
    // The top-level `request` fixture would NOT do: it carries no owner cookies, so it is a
    // stranger, and the test would pass only while recording was broken.
    //
    // This guard was dead for its whole first life: the check read the session cookie, which is
    // Path=/api/admin and never reaches /api/v1, so it always answered "not the owner". The
    // panel showed eight views on an instance nobody had visited.
    const before = await readerRowCount(adminPage);
    const res = await adminPage.request.get(`/api/v1/wiki/${ENTRY.path}`, {
      headers: { 'User-Agent': HUMAN_UA },
    });
    expect(res.status(), 'the owner must actually reach the page').toBe(200);

    // A delta, not an absolute. Other traffic exists on this instance by the time this runs,
    // and an absolute count would make this test a statement about the harness rather than
    // about the exclusion.
    expect(await readerRowCount(adminPage)).toBe(before);
  });

  test('a real visit appears on the panel, with the entry title and the reader', async (
    { adminPage, playwright },
  ) => {
    await readAsVisitor(playwright, ENTRY.path);
    await openPanel(adminPage);

    // Asserted on the ROW, not on a count. A count is shared state — the harness's own sign-in
    // records index views, the fire-and-forget beacon lands whenever it lands, and repeats
    // accumulate — so a delta measures the harness as much as the product. A row is
    // addressable: it is either on the panel saying the right thing, or it is not. The exact
    // arithmetic is asserted in monitor-records-a-reader-view, which involves no browser.
    //
    // Find the row by what it says, not by where it sits. `.first()` assumes nothing else
    // landed after this test's visit, and something does: the harness's own sign-in records
    // index views, and rows written in the same instant have no defined order between them.
    const row = adminPage.getByTestId('monitor-row')
      .filter({ hasText: ENTRY.title });
    await expect(row.first()).toBeVisible();
    // The feed names the ENTRY, not its path: an owner recognises what they wrote.
    await expect(row.first().getByTestId('monitor-row-what')).toHaveText(ENTRY.title);
    await expect(row.first()).toContainText('reader');
    await expect(row.first()).toContainText('Chrome');
  });

  test('a crawler shows in the feed but stays out of the four human numbers', async (
    { adminPage, playwright },
  ) => {
    await asStranger(playwright, 'Mozilla/5.0 (compatible; Googlebot/2.1)',
      `/api/v1/wiki/${ENTRY.path}`);
    await openPanel(adminPage);

    // Counted, and NAMED — "a bot came" is worth less than "Googlebot came", and the name is
    // the only reason a crawler's identity is stored at all. Asserted on the row, for the same
    // reason as the test above: a count is shared state, a row is addressable.
    const botRow = adminPage.getByTestId('monitor-row').filter({ hasText: 'Googlebot' });
    await expect(botRow.first()).toBeVisible();
    // It names the entry it fetched, so the owner can see WHAT was crawled, not just that
    // something was.
    await expect(botRow.first()).toContainText(ENTRY.title);

    // And the crawler is not described as a reader: the human columns stay empty for it, which
    // is what keeps "2 crawlers" and "1 viewer" legible as different populations.
    await expect(botRow.first()).not.toContainText('Chrome');
  });
});

// openPanel —— navigate to the panel and wait until it has finished loading.
//
// The wait is not optional. The store refreshes on every mount (traffic is live), and while
// that is in flight the feed renders its loading line and no rows at all — so an assertion
// fired straight after navigation intermittently sees an empty panel and reports "the row was
// never recorded", which is a different and much more alarming claim than "not yet drawn".
async function openPanel(page: Page): Promise<void> {
  await gotoAdminSection(page, 'monitor');
  await page.getByTestId('monitor-summary').waitFor();
  await expect(page.getByTestId('monitor-loading')).toHaveCount(0);
}

// readerRowCount —— how many reader events the panel is showing.
async function readerRowCount(page: Page): Promise<number> {
  await openPanel(page);
  return page.getByTestId('monitor-row').filter({ hasText: 'reader' }).count();
}

// readAsVisitor —— a real visitor, from a context that carries none of the owner's cookies.
//
// The shared `request` fixture holds the owner's session, and the owner is excluded by design
// (§4.11). A visitor has to be a fresh context, or this would be testing the exclusion instead
// of the recording, and would go green for the wrong reason.
async function readAsVisitor(playwright: Playwright, path: string): Promise<void> {
  await asStranger(playwright, HUMAN_UA, `/api/v1/wiki/${path}`);
}

// asStranger —— one request from a context that shares nothing with this test's owner session.
//
// baseURL has to be passed explicitly: a context made with newContext() inherits nothing from
// the config, so a relative path resolves nowhere and the request silently reaches no server.
// That is a green-looking nothing — the panel stays at zero and the failure reads as "recording
// is broken" rather than "the test never asked".
async function asStranger(pw: Playwright, userAgent: string, path: string): Promise<void> {
  const ctx = await pw.request.newContext({
    baseURL: process.env['BASE_URL'] ?? 'http://localhost:38127',
    extraHTTPHeaders: { 'User-Agent': userAgent },
  });
  const res = await ctx.get(path);
  await ctx.dispose();
  expect(res.status(), `the visitor request must reach the server: ${path}`).toBe(200);
}

async function initOwnerWithEntry(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'monitor-panel-seed');
  const sid = await initMCP(request, token);
  const { wikiID } = await seedWiki(request, token, sid, {
    title: ENTRY.title, body: 'Notes on consolidation during slow-wave sleep.', path: ENTRY.path,
  });
  await publishEntry(request, token, sid, { genre: 'wiki', id: wikiID });
  await request.dispose();
}
