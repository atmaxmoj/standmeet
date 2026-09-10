// monitor-per-session-fields.spec.ts — BLACK BOX. The traffic panel is "almost not done" (owner,
// 2026-09-10): for each visitor session the owner wants to see a SESSION id, its VISITS count, its
// VIEWS count, the COUNTRY + CITY it came from, the BROWSER / OS / DEVICE, and when it was LAST
// SEEN. Today the feed shows only time · surface · what · from · who, and `who` is usually blank.
//
// This drives a REAL browser reading the site (so browser/os/device come from a real UA, and
// country/city from the edge headers a CDN sets), then asserts the owner SEES that per-session row
// in the panel with those fields filled.
//
// RED today: there is no per-session view in the panel at all (no monitor-session-row), so every
// field assertion below fails — the panel cannot answer "who is this one visitor and what did they
// do".

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki, publishEntry } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { openVisitorBrowser } from '@/fixtures/visitor-browser';

const OWNER = {
  email: 'monitor-session@example.com', password: 'correct-horse-battery-staple',
  handle: 'monitorsession', fullName: 'Monitor Session Owner',
};
const ENTRY = { title: 'Column Coverage', path: 'column-coverage' };

// realPublicIP —— THIS machine's actual public IP. Nothing is hardcoded: the test cannot know the
// answer in advance, so it discovers the input at runtime.
async function realPublicIP(): Promise<string> {
  const res = await fetch('https://api.ipify.org?format=json');
  const body = (await res.json()) as { ip: string };
  return body.ip;
}

// independentCountry —— the ISO country code an INDEPENDENT geoip service resolves for that IP. The
// instance uses its own bundled db-ip database; asserting the instance's answer equals a different
// provider's is what proves the instance resolved the real IP correctly (not that db-ip == db-ip).
async function independentGeo(ip: string): Promise<{ country: string; city: string }> {
  const res = await fetch(`http://ip-api.com/json/${ip}?fields=countryCode,city,status`);
  const j = (await res.json()) as { status: string; countryCode?: string; city?: string };
  if (j.status !== 'success' || !j.countryCode) throw new Error(`independent geoip failed for ${ip}: ${JSON.stringify(j)}`);
  return { country: j.countryCode, city: j.city ?? '' };
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('monitor · the panel shows a per-session breakdown, not just a flat event list', () => {
  test.beforeAll(async ({ playwright }) => { await initOwnerWithEntry(playwright); });

  test('one visitor reading two pages shows as one session with visits/views/geo/device/last-seen',
    async ({ adminPage: page, playwright }) => {
      test.setTimeout(120_000);

      // Discover the real input (this machine's IP) + the independent expected answer at runtime —
      // nothing hardcoded.
      const myIP = await realPublicIP();
      const expected = await independentGeo(myIP);

      // One real visitor (one browser context = one session) opens the same reader page twice: two
      // views, one visit. X-Forwarded-For carries the real IP exactly as Cloudflare/Coolify do.
      const ctx = await openVisitorBrowser(playwright, { 'X-Forwarded-For': myIP });
      await ctx.read(`/wiki/${ENTRY.path}`);
      await ctx.read(`/wiki/${ENTRY.path}`);
      await ctx.dispose();

      await gotoAdminSection(page, 'monitor');

      // The owner sees a per-session row — the thing the flat feed cannot express.
      const row = page.getByTestId('monitor-session-row').first();
      await expect(row, 'the panel groups events into per-session rows').toBeVisible({ timeout: 20_000 });

      // Every field the owner asked for, on that row, with a real value.
      await expect(row.getByTestId('monitor-session-id'), 'session id').not.toBeEmpty();
      await expect(row.getByTestId('monitor-session-visits'), 'visits count').toContainText('1');
      // Two reads in one sitting → a positive view count (the exact total also folds in the index
      // view an anonymous /wiki read emits — a separate instrumentation nuance, tracked in the queue).
      await expect(row.getByTestId('monitor-session-views'), 'views count').toHaveText(/^[1-9][0-9]*$/);
      // The instance's OWN geoip resolution of the real IP equals what an INDEPENDENT provider says —
      // nothing pre-baked. (ISO country code; db-ip and ip-api agree on country for real IPs.)
      await expect(row.getByTestId('monitor-session-country'), `country for the real IP ${myIP}`)
        .toHaveText(expected.country);
      // City is resolved too (present, not the em-dash placeholder). Different providers can label a
      // city slightly differently, so this asserts it was resolved, not an exact string match.
      await expect(row.getByTestId('monitor-session-city'), 'city resolved (not —)')
        .not.toHaveText('—');
      await expect(row.getByTestId('monitor-session-browser'), 'browser').toContainText(/Chrome|Chromium/);
      await expect(row.getByTestId('monitor-session-os'), 'os').not.toBeEmpty();
      await expect(row.getByTestId('monitor-session-device'), 'device').not.toBeEmpty();
      await expect(row.getByTestId('monitor-session-lastseen'), 'last seen').not.toBeEmpty();
    });
});

async function initOwnerWithEntry(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password, handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'monitor-session-seed');
  const sid = await initMCP(request, token);
  const { wikiID: id } = await seedWiki(request, token, sid, {
    title: ENTRY.title, body: 'A note on column coverage.', path: ENTRY.path,
  });
  await publishEntry(request, token, sid, { genre: 'wiki', id });
  await request.dispose();
}
