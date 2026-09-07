// monitor-beacon.spec.ts —— POST /api/v1/t, the browser's half of the instrumentation.
//
// This is the one place an anonymous stranger can write a row into the owner's database, so
// most of this file is about what they CANNOT write. The endpoint answers 204 to everything, by
// design — a visitor must never see an error from analytics, and a caller must not be able to
// use the response to learn which slugs exist. That makes the status useless as a signal: every
// assertion here reads the recorded rows back instead.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki, publishEntry } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { HUMAN_UA, readEvents } from '@/fixtures/monitor';

const OWNER = {
  email: 'monitor-beacon@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'monitorbeacon',
  fullName: 'Monitor Beacon',
};

const ENTRY = { title: 'Beacon Test Entry', path: 'beacon-test-entry' };
const BASE = process.env['BASE_URL'] ?? 'http://localhost:38127';

let wikiID = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('monitor beacon · the browser reports what a request cannot show', () => {
  test.beforeAll(async ({ playwright }) => {
    wikiID = await initOwner(playwright);
  });

  test('an index view is recorded — the surface has no other signal', async (
    { request, playwright },
  ) => {
    await beacon(playwright, { surface: 'index', url: '/' });

    const rows = await readEvents(request, OWNER, { surface: 'index' });
    const row = rows[0];
    expect(row, 'the index view must be recorded').toBeTruthy();
    expect(row?.event_name).toBe('');
    expect(row?.url_path).toBe('/');
    // Derived from the request, not from anything the body claimed.
    expect(row?.browser).toBe('Chrome');
    expect(row?.is_bot).toBe(false);
  });

  test('scroll depth arrives as a named event with its threshold', async (
    { request, playwright },
  ) => {
    await beacon(playwright, {
      surface: 'reader', name: 'scroll_depth', url: `/wiki/${ENTRY.path}`,
      entity_kind: 'wiki', entity_slug: ENTRY.path, props: { depth: '75' },
    });

    const rows = await readEvents(request, OWNER, { event: 'scroll_depth' });
    const row = rows[0];
    expect(row, 'the scroll event must be recorded').toBeTruthy();
    expect(row?.props['depth']).toBe('75');
    // The entity is resolved SERVER-side from the slug: the body never named an id.
    expect(row?.entity_id).toBe(wikiID);
  });

  test('an unknown event name is dropped', async ({ request, playwright }) => {
    const before = await readEvents(request, OWNER, { include_bots: true });
    await beacon(playwright, { surface: 'index', name: 'totally_made_up', url: '/' });
    const after = await readEvents(request, OWNER, { include_bots: true });

    // An open name field lets a stranger write whatever they like into the owner's panel.
    expect(after.length).toBe(before.length);
  });

  test('a known event on a surface it does not belong to is dropped', async (
    { request, playwright },
  ) => {
    const before = await readEvents(request, OWNER, { include_bots: true });
    // read_complete is real, but only a reader can report it. Allowing it anywhere would let a
    // caller inflate "people finished reading" from a page that has nothing to read.
    await beacon(playwright, { surface: 'gate', name: 'read_complete', url: '/gate' });
    const after = await readEvents(request, OWNER, { include_bots: true });

    expect(after.length).toBe(before.length);
  });

  test('the caller cannot name an entity id, only a slug', async ({ request, playwright }) => {
    await beacon(playwright, {
      surface: 'reader', name: 'read_complete', url: `/wiki/${ENTRY.path}`,
      entity_kind: 'wiki', entity_slug: 'no-such-entry',
      // A forged id, ignored: the body has no entity_id field at all, and the resolver is the
      // only thing that can produce one. Without this, anyone could pile reads onto one entry.
      entity_id: '00000000-0000-0000-0000-000000000000',
    });

    const rows = await readEvents(request, OWNER, { event: 'read_complete' });
    const row = rows[0];
    expect(row, 'the event is still recorded').toBeTruthy();
    expect(row?.entity_id).not.toBe('00000000-0000-0000-0000-000000000000');
    // An unresolvable slug leaves the entity empty rather than inventing one.
    expect(row?.entity_id).toBe('');
  });

});

test.describe('monitor beacon · bounded payloads', () => {
  test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

  // Two separate protections, tested separately — they fail in different ways and conflating
  // them hides one. An over-limit body never parses, so it can never demonstrate capping.

  test('a body over the size limit is dropped whole', async ({ request, playwright }) => {
    const before = await readEvents(request, OWNER, { include_bots: true });
    const props: Record<string, string> = {};
    for (let i = 0; i < 40; i += 1) props[`k${i}`] = 'x'.repeat(400); // ~16 KB
    await beacon(playwright, {
      surface: 'index', name: 'contact_click', url: '/', props,
    });
    const after = await readEvents(request, OWNER, { include_bots: true });

    // A beacon is a few hundred bytes. Anything larger is not a beacon, and reading it at all
    // would make this endpoint a way to spend the instance's memory from the outside.
    expect(after.length).toBe(before.length);
  });

  test('props inside the size limit are capped in count and length', async (
    { request, playwright },
  ) => {
    const props: Record<string, string> = {};
    for (let i = 0; i < 12; i += 1) props[`k${i}`] = 'x'.repeat(200); // ~2.6 KB, parses fine
    await beacon(playwright, {
      surface: 'index', name: 'hero_cta_click', url: '/', props,
    });

    const rows = await readEvents(request, OWNER, { event: 'hero_cta_click' });
    const row = rows[0];
    expect(row, 'the event is recorded, just bounded').toBeTruthy();
    expect(Object.keys(row?.props ?? {}).length).toBeLessThanOrEqual(8);
    for (const value of Object.values(row?.props ?? {})) {
      expect(value.length).toBeLessThanOrEqual(120);
    }
  });
});

test.describe('monitor beacon · a caller with no user agent is refused', () => {
  test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

  test('nothing is recorded', async ({ request, playwright }) => {
    const before = await readEvents(request, OWNER, { include_bots: true });
    const ctx = await playwright.request.newContext({ baseURL: BASE });
    await ctx.post('/api/v1/t', {
      headers: { 'User-Agent': '', 'Content-Type': 'application/json' },
      data: { surface: 'index', name: '', url: '/' },
    });
    await ctx.dispose();
    const after = await readEvents(request, OWNER, { include_bots: true });

    // The cheapest bulk-forgery path, closed the same way umami closes it.
    expect(after.length).toBe(before.length);
  });
});

// beacon —— post one event from a stranger's browser.
async function beacon(
  pw: Playwright, payload: Record<string, unknown>, userAgent = HUMAN_UA,
): Promise<void> {
  const ctx = await pw.request.newContext({
    baseURL: BASE, extraHTTPHeaders: { 'User-Agent': userAgent },
  });
  const res = await ctx.post('/api/v1/t', { data: payload });
  await ctx.dispose();
  // 204 whatever happened — which is exactly why nothing here asserts on the body.
  expect(res.status()).toBe(204);
}

async function initOwner(playwright: Playwright): Promise<string> {
  resetInstance();
  const request: APIRequestContext = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'monitor-beacon-seed');
  const sid = await initMCP(request, token);
  const { wikiID: id } = await seedWiki(request, token, sid, {
    title: ENTRY.title, body: 'Something to scroll through.', path: ENTRY.path,
  });
  await publishEntry(request, token, sid, { genre: 'wiki', id });
  await request.dispose();
  return id;
}
