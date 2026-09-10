// monitor-real-page-load-not-self-counted.spec.ts — BLACK BOX. A real browser opens the real
// public reader PAGE (/wiki/<slug>), the way a visitor does — not a raw GET of /api/v1/wiki/<slug>
// with a typed-in User-Agent (that is what every other monitor spec does, and it is why the bugs
// below are invisible to them: a single hand-made API call never runs the page's own fetches).
//
// The claim under test (owner: "别自己服务器 call 自己他也算上啊"): ONE real page open is ONE
// recorded human read. The app must not count ITS OWN server-side fetch as a visitor.
//
// Why this is currently RED (the bug this guards):
//   - the reader page is server-rendered; the app CONTAINER fetches /api/v1/wiki/<slug> over the
//     container network to render it (public.ts SSR baseURL; wiki/page.tsx "SSR fetches …");
//   - that exact route is in the monitor rule table (monitor/mw/routes.go), and shouldRecord
//     (monitor/ops/record.go) excludes only the owner + separates bots — there is NO self / internal
//     / loopback exclusion, and the SSR fetch does not carry the visitor's IP or browser UA;
//   - so the server's call to itself lands as a PHANTOM reader row (empty browser, a container
//     "viewer"), and the browser's own client re-fetch lands too → one open, ≥2 rows.
//
// The assertions read the rows back through the owner's own panel API (what the owner sees), never
// the 200 from the page (a 200 is not a receipt).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki, publishEntry } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { readEvents } from '@/fixtures/monitor';
import { openVisitorBrowser } from '@/fixtures/visitor-browser';

const OWNER = {
  email: 'monitor-selfcount@example.com', password: 'correct-horse-battery-staple',
  handle: 'monitorself', fullName: 'Monitor Self Owner',
};
const ENTRY = { title: 'Deterministic State Holder', path: 'deterministic-state-holder' };

// A visitor from a place with a CDN edge in front (the header set prod actually has). It exercises
// country/city end-to-end AND marks the REAL browser request apart from the app's server fetch.
const GEO = { 'cf-ipcountry': 'US', 'cf-region-code': 'CA', 'cf-ipcity': 'San Francisco' };

let wikiID = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('monitor · one real page open is one human read (the app does not count itself)', () => {
  test.beforeAll(async ({ playwright }) => { wikiID = await initOwnerWithEntry(playwright); });

  test('a real browser reading /wiki/<slug> once is recorded once, with a real browser and no phantom',
    async ({ request, playwright }) => {
      test.setTimeout(90_000);
      const visitor = await openVisitorBrowser(playwright, GEO);
      await visitor.read(`/wiki/${ENTRY.path}`);
      await visitor.dispose();

      // Exactly ONE reader view for this entry. The app's SSR fetch to itself must not be counted,
      // so one human open is one row — not the two (SSR self-call + client re-fetch) shipping today.
      await expect.poll(
        async () => (await entryReaderRows(request)).length,
        { message: 'one real page open = one recorded read (the SSR self-call must not count)', timeout: 30_000 },
      ).toBe(1);

      const rows = await entryReaderRows(request);
      // No phantom self-call row: the app's own server-side fetch carries no browser UA, so an
      // empty-browser reader row is the server counting itself.
      expect(
        rows.every((r) => r.browser !== ''),
        'no reader row may have an empty browser — that row is the app counting its own SSR fetch',
      ).toBe(true);

      // The one real visit carries the real client's browser/os/device and the visitor's country.
      const v = rows[0];
      expect(v.is_bot, 'a real visitor is not a bot').toBe(false);
      expect(v.browser, 'the real visitor has a browser').not.toBe('');
      expect(v.os, 'the real visitor has an os').not.toBe('');
      expect(v.country, 'the visitor country comes from the edge header').toBe('US');
      expect(v.viewer_id, 'the visit has a viewer id').not.toBe('');
      expect(v.visit_id, 'the visit has a session/visit id').not.toBe('');
    });
});

// entryReaderRows — every reader row recorded for THIS entry, bots included (so a self-call
// mistaken for a bot would still show up rather than hide).
async function entryReaderRows(request: APIRequestContext) {
  return readEvents(request, OWNER, { surface: 'reader', entity_id: wikiID, include_bots: true });
}

async function initOwnerWithEntry(playwright: Playwright): Promise<string> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password, handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'monitor-selfcount-seed');
  const sid = await initMCP(request, token);
  const { wikiID: id } = await seedWiki(request, token, sid, {
    title: ENTRY.title, body: 'A note on deterministic state holders.', path: ENTRY.path,
  });
  await publishEntry(request, token, sid, { genre: 'wiki', id });
  await request.dispose();
  return id;
}
