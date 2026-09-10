// monitor-microsite-tracker.spec.ts —— the owner's front page reports what happens on it.
//
// The homepage is a microsite: the reserved `home` page, built from owner-editable React and
// served at `/`. That is why its instrumentation lives in the BUILD TEMPLATE
// (builder/template/src/track.ts) rather than in the page or in a widget — the owner rewrites
// that page freely, and anything they can delete by tidying their own file is not
// instrumentation, it is a suggestion.
//
// So this spec builds the real default homepage — the source is read from the file the backend
// embeds, so the shipped template is what is under test, not a stub written here — drives it in a
// browser, and reads the rows back. It is slow — a real vite build in the sandbox — and there is
// no cheaper honest path: a tracker that never made it into a build is exactly the failure this
// file exists to catch, and only a build can show it.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { publishEntry, seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { openReader } from '@/fixtures/navigate';
import { readEvents } from '@/fixtures/monitor';
import type { MonitorEvent } from '@/fixtures/monitor';
import { seedDefaultHomepage } from '@/fixtures/microsite-rig';

const OWNER = {
  email: 'monitor-microsite@example.com', password: 'correct-horse-battery-staple',
  handle: 'monitormicrosite', fullName: 'Monitor Microsite',
};

// `path` is TREE-DERIVED from the slugified title, not from the argument seedWiki takes — so it
// keeps the leading "the". Spelling it any other way here asserts against an address the product
// never produces, and the failure reads as "the tracker names the wrong card".
const NOTE = { title: 'The Deterministic State Holder', path: 'the-deterministic-state-holder' };

test.describe.configure({ timeout: 420_000 });
test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('monitor · the homepage build carries its own instrumentation', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(420_000);
    await buildHomepage(playwright);
  });

  test('clicking a corpus card is recorded, naming the entry', async ({ page, request }) => {
    await openReader(page, '/');
    const card = page.getByText(NOTE.title, { exact: false }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.click();

    const row = await trackerRow(request, 'pin_click');
    expect(row, 'a card click on the homepage must be recorded').toBeTruthy();
    // Which card. "Someone clicked something on your homepage" is not information; "people open
    // this note from your front page" is the one thing the pinned list exists to tell you.
    expect(row?.props['path']).toBe(NOTE.path);
    // The homepage IS a microsite, and calling it anything else here would file the same page
    // under two surfaces depending on which URL a visitor arrived by.
    expect(row?.surface).toBe('microsite');
    expect(row?.entity_kind).toBe('microsite');
  });

  test('focusing the ask box is recorded — considering a question, not only asking one', async (
    { page, request },
  ) => {
    await openReader(page, '/');
    const input = page.getByTestId('agent-widget-input');
    await expect(input).toBeVisible({ timeout: 30_000 });
    await input.focus();

    const row = await trackerRow(request, 'chat_input_focus');
    // The ask box navigates away on submit, so counting only submissions misses everyone who
    // opened it and thought better of it — which is the more interesting half of the funnel.
    expect(row, 'focusing the ask box must be recorded').toBeTruthy();
    expect(row?.surface).toBe('microsite');
  });

  test('clicking the access CTA is recorded', async ({ page, request }) => {
    await openReader(page, '/');
    const cta = page.getByTestId('gate-widget');
    await expect(cta).toBeVisible({ timeout: 30_000 });
    await cta.click();

    const row = await trackerRow(request, 'hero_cta_click');
    expect(row, 'the gate CTA must be recorded').toBeTruthy();
    expect(row?.props['cta']).toBe('gate');
  });

  test('clicking a contact link is recorded, naming the channel', async ({ page, request }) => {
    await openReader(page, '/');
    const mail = page.locator('a[href^="mailto:"]').first();
    await expect(mail).toBeVisible({ timeout: 30_000 });
    await mail.click();

    const row = await trackerRow(request, 'contact_click');
    // The owner writes these links by hand, so the rule matches what they ARE rather than a
    // testid the owner never added. A rule keyed on a testid would silently stop matching the
    // moment an owner edited their own contact section — which is every owner, eventually.
    expect(row, 'a mailto click must be recorded').toBeTruthy();
    expect(row?.props['channel']).toBe('email');
  });

  test('the tracker survives being in a build the owner did not write', async (
    { page, request },
  ) => {
    await openReader(page, '/');
    await expect(page.getByTestId('agent-widget-input')).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, scrollable);
    });
    // The poll on the recorded row below is the wait. A sleep here would be guessing at the same
    // thing and would still have to be followed by the poll.
    await page.waitForFunction(() => window.scrollY > 0);

    const row = await trackerRow(request, 'scroll_depth');
    // Depth on the front page, from the same shell. If main.tsx stopped calling track(), every
    // test above would fail together — and this one says which layer it was: the shell, not any
    // one rule.
    expect(row, 'the homepage reports reading depth').toBeTruthy();
    expect(row?.surface).toBe('microsite');
  });
});

// trackerRow —— the newest row for one event, waited for. The tracker uses sendBeacon, so the
// click returns before the row exists.
async function trackerRow(
  request: APIRequestContext, name: string,
): Promise<MonitorEvent | undefined> {
  let found: MonitorEvent | undefined;
  await expect.poll(async () => {
    const rows = await readEvents(request, OWNER, { event: name, include_bots: true });
    found = rows[0];
    return rows.length;
  }, { timeout: 20_000, intervals: [500] }).toBeGreaterThan(0);
  return found;
}

async function buildHomepage(playwright: Playwright): Promise<void> {
  resetInstance();
  const request: APIRequestContext = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'monitor-microsite-seed');
  const sid = await initMCP(request, token);
  const note = await seedWiki(request, token, sid, {
    title: NOTE.title, body: 'A card to click on the front page.', path: NOTE.path,
  });
  await publishEntry(request, token, sid, {
    genre: 'wiki', id: note.wikiID, excerpt: 'a curated card excerpt',
  });
  // Claim no longer installs the `home` page (it renders DefaultHome from current code instead),
  // so this spec creates it — from the shipped template, which is what it exercises.
  await seedDefaultHomepage(request, csrf);
  await request.dispose();
}
