// monitor-deep-tree.spec.ts —— instrumentation survives the corpus moving underneath it.
//
// This is the invariant the whole design is built on (docs/design/monitor.md §6 rule 1): a row
// stores the entry's IMMUTABLE id, never its slug. A slug is an address, and an address changes —
// an entry gets renamed, or reparented three levels up, and a panel keyed on the slug splits that
// entry's history into two entries that each look half as read as the real one.
//
// A shallow entry cannot show this. `/wiki/note` renamed to `/wiki/note-2` is one segment moving,
// and code that happens to key on the last segment passes. So everything here runs on a five-deep
// tree, and the move that follows changes every segment of the path at once.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki, publishEntry } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';
import { HUMAN_UA, readEvents, visitAsStranger } from '@/fixtures/monitor';

const OWNER = {
  email: 'monitor-deeptree@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'monitordeeptree',
  fullName: 'Monitor Deep Tree',
};

// Five levels. Deep enough that the leaf's address shares no segment with its post-move address,
// so "the id followed the entry" cannot be satisfied by any part of the path surviving.
const DEEP = 'research/systems/storage/indexing/write-amplification';
const LEAF_TITLE = 'Write Amplification';
const BASE = process.env['BASE_URL'] ?? 'http://localhost:38127';

let leafID = '';
let midID = '';
let token = '';
let sid = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('monitor · a deep tree, and an entry that moves inside it', () => {
  test.beforeAll(async ({ playwright }) => {
    await seedDeepTree(playwright);
  });

  test('a read five levels down is filed against the leaf, not an ancestor', async (
    { request, playwright },
  ) => {
    await visitAsStranger(playwright, `/api/v1/wiki/${DEEP}`);

    const rows = await readEvents(request, OWNER, { entity_id: leafID });
    const row = rows.find((r) => r.url_path === `/api/v1/wiki/${DEEP}`.replace('/api/v1', ''));
    expect(row, 'the deep read must be recorded against the leaf').toBeTruthy();
    expect(row?.entity_id).toBe(leafID);
    // The ancestors are real entries with real ids of their own. Resolving the wildcard slug to
    // the FIRST matching segment rather than the whole path would file this read under
    // `research`, and every leaf under it would collapse into one very popular ancestor.
    expect(row?.entity_id).not.toBe(midID);
    expect(row?.entity_title).toBe(LEAF_TITLE);
  });

  test('the browser reporting a deep slug resolves to the same entry', async (
    { request, playwright },
  ) => {
    await beacon(playwright, {
      surface: 'reader', name: 'tree_expand', url: `/wiki/${DEEP}`,
      entity_kind: 'wiki', entity_slug: DEEP, props: { path: DEEP },
    });

    const rows = await readEvents(request, OWNER, { event: 'tree_expand' });
    const row = rows[0];
    expect(row, 'the beacon must be recorded').toBeTruthy();
    // Server-side resolution, on the full multi-segment path. A resolver that only handled a
    // single segment would leave this empty — and an empty entity is not an error anywhere, it
    // simply drops the event off every per-entry list without saying so.
    expect(row?.entity_id).toBe(leafID);
    expect(row?.props['path']).toBe(DEEP);
  });

  test('reparenting the leaf to the root keeps its history together', async (
    { request, playwright },
  ) => {
    // Before: one read at the deep address.
    const before = await readEvents(request, OWNER, { entity_id: leafID, limit: 1000 });
    expect(before.length, 'there is history to keep together').toBeGreaterThan(0);

    // The move. Every segment of the address changes at once: five levels down becomes root.
    // corpus.update requires title and body on every call, so the current ones are read back and
    // handed straight in — nothing about the entry changes except where it hangs.
    const current = await entryOf(request, leafID);
    await callTool(request, token, sid, 'corpus.update', {
      genre: 'wiki', id: leafID, parent_id: '',
      title: current.title, body: current.body,
    });
    const moved = await slugOf(request, leafID);
    expect(moved, 'the address really did change').not.toBe(DEEP);

    // After: a read at the NEW address.
    await visitAsStranger(playwright, `/api/v1/wiki/${moved}`);

    const after = await readEvents(request, OWNER, { entity_id: leafID, limit: 1000 });
    expect(after.length, 'the new read joined the old ones').toBe(before.length + 1);
    // Two different addresses, one entry. This is the assertion that fails the moment a row
    // stores a slug: the reads would be two entries, and the panel would show one entry that had
    // stopped being read and one that had just appeared.
    const paths = new Set(after.map((r) => r.url_path));
    expect(paths.has(`/wiki/${DEEP}`), 'the old address is still in the history').toBe(true);
    expect(paths.has(`/wiki/${moved}`), 'and so is the new one').toBe(true);
  });

  test('a read of an ancestor is still its own entry', async ({ request, playwright }) => {
    await visitAsStranger(playwright, '/api/v1/wiki/research/systems/storage');

    const rows = await readEvents(request, OWNER, { entity_id: midID });
    const row = rows[0];
    // The mirror of the first test. Grouping by prefix rather than by id would make an ancestor
    // inherit every descendant's reads, which reads as "the index page is the most popular thing
    // on the site" — a number that is always true and never useful.
    expect(row, 'the ancestor read is recorded against the ancestor').toBeTruthy();
    expect(row?.entity_id).toBe(midID);
    expect(row?.entity_id).not.toBe(leafID);
  });
});

interface WikiEntry { path?: string; title?: string; body?: string }

// entryOf —— the entry as the corpus currently holds it.
async function entryOf(
  request: APIRequestContext, id: string,
): Promise<{ path: string; title: string; body: string }> {
  const entry = await callTool<WikiEntry>(
    request, token, sid, 'corpus.get', { genre: 'wiki', id },
  );
  return { path: entry.path ?? '', title: entry.title ?? '', body: entry.body ?? '' };
}

// slugOf —— an entry's current address, read back from the corpus rather than assumed.
async function slugOf(request: APIRequestContext, id: string): Promise<string> {
  return (await entryOf(request, id)).path;
}

async function beacon(pw: Playwright, payload: Record<string, unknown>): Promise<void> {
  const ctx = await pw.request.newContext({
    baseURL: BASE, extraHTTPHeaders: { 'User-Agent': HUMAN_UA },
  });
  const res = await ctx.post('/api/v1/t', { data: payload });
  await ctx.dispose();
  expect(res.status()).toBe(204);
}

async function seedDeepTree(playwright: Playwright): Promise<void> {
  resetInstance();
  const request: APIRequestContext = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  token = await createAPIToken(request, csrf, 'monitor-deeptree-seed');
  sid = await initMCP(request, token);
  const leaf = await seedWiki(request, token, sid, {
    title: LEAF_TITLE,
    body: 'Five levels down, so that a move changes every segment of the address.',
    path: DEEP,
  });
  leafID = leaf.wikiID;
  await publishEntry(request, token, sid, { genre: 'wiki', id: leafID });
  // The ancestors are created by seedWiki's parent chain; publish the middle one so a read of it
  // is a real 200 rather than a 404 the recorder correctly skips.
  midID = await idOfPath(request, 'storage');
  await publishEntry(request, token, sid, { genre: 'wiki', id: midID });
  await request.dispose();
}

interface WikiRow { id: string; title: string }

// idOfPath —— the ancestor's own id, looked up by the title seedWiki gave it (each path segment
// becomes a node whose title is that segment).
async function idOfPath(request: APIRequestContext, title: string): Promise<string> {
  const rows = await callTool<WikiRow[]>(
    request, token, sid, 'corpus.list', { genre: 'wiki', limit: 200 },
  );
  const hit = rows.find((r) => r.title === title);
  expect(hit, `the seeded ancestor "${title}" must exist`).toBeTruthy();
  return hit?.id ?? '';
}
