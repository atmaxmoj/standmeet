// monitor-records-a-reader-view.spec.ts —— the monitor domain's core claim, end to end.
//
// A visitor reads a public corpus entry; a row lands carrying that entry's IMMUTABLE id.
//
// Why the id and not the path (docs/design/monitor.md §6 rule 1): a corpus slug can be renamed
// and reparented — `corpus-reparent-path.spec.ts` exercises exactly that — and an aggregate
// keyed on a path splits one entry's history into two rows that cannot be summed. The entry
// then looks like it lost all its readers.
//
// Two rules this file follows, both of them defects this repo has already shipped:
//
//  1. **A 200 is not a receipt.** The public reader answers 200 whether or not anything was
//     recorded. Every assertion here reads the ROW back through the admin API.
//  2. **Do not feed the code the answer.** The visit is made by SLUG. The wiki id is fetched
//     separately and only used to assert what came back. If the id were passed into the
//     request being measured, the resolution path this test exists for would never run.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki, publishEntry } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { HUMAN_UA, readEvents, readSummary, visitAsStranger } from '@/fixtures/monitor';
import type { MonitorEvent } from '@/fixtures/monitor';

const OWNER = {
  email: 'monitor-reader@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'monitorreader',
  fullName: 'Monitor Reader',
};

const ENTRY = { title: 'Attention Is All You Need', path: 'attention-is-all-you-need' };

let wikiID = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('monitor · a public reader view is recorded against the entry id', () => {
  test.beforeAll(async ({ playwright }) => {
    wikiID = await initOwnerWithEntry(playwright);
  });

  test('the row carries the entry id, resolved from the slug alone', async (
    { request, playwright },
  ) => {
    await readAsVisitor(playwright, ENTRY.path);

    const row = await newestReaderRow(request);

    // The claim this whole domain rests on: the immutable id, worked out from the slug.
    expect(row.entity_kind).toBe('wiki');
    expect(row.entity_id).toBe(wikiID);
    expect(row.entity_title).toBe(ENTRY.title);
  });

  test('the recorded path is the visitor page, not the API route behind it', async (
    { request, playwright },
  ) => {
    await readAsVisitor(playwright, ENTRY.path);

    const rows = await readEvents(request, OWNER, { surface: 'reader' });
    const paths = rows.map((r) => r.url_path);
    // An owner reading their panel must see a path a visitor could have typed. `/api/v1/...`
    // is the route the backend served, which no visitor ever visits and no owner recognises.
    expect(paths[0]).toBe(`/wiki/${ENTRY.path}`);
    expect(paths.some((p) => p.startsWith('/api/'))).toBe(false);
  });

  test('the visitor is classified, and the view counts as a view', async (
    { request, playwright },
  ) => {
    await readAsVisitor(playwright, ENTRY.path);

    const row = await newestReaderRow(request);
    // event_name empty is what makes this a view rather than a custom event; the summary's
    // `views` counts exactly those.
    expect(row.event_name).toBe('');
    expect(row.is_bot).toBe(false);
    expect(row.browser).toBe('Chrome');
    expect(row.os).toBe('macOS');
    expect(row.viewer_id).not.toBe('');
    expect(row.visit_id).not.toBe('');

    const summary = await readSummary(request, OWNER);
    expect(summary.views).toBeGreaterThan(0);
    expect(summary.viewers).toBeGreaterThan(0);
  });

  test('a request that 404s is not counted as a read', async ({ request, playwright }) => {
    const before = await readEvents(request, OWNER, { surface: 'reader' });
    await visitAsStranger(playwright, '/api/v1/wiki/no-such-entry-exists', HUMAN_UA, 404);
    const after = await readEvents(request, OWNER, { surface: 'reader' });

    // Counting a miss would put entries that do not exist onto the "most read" list.
    expect(after.length).toBe(before.length);
  });

  test('a crawler is recorded, named, and kept out of the numbers', async (
    { request, playwright },
  ) => {
    const humanBefore = (await readSummary(request, OWNER)).views;

    await visitAsStranger(playwright, `/api/v1/wiki/${ENTRY.path}`,
      'Mozilla/5.0 (compatible; ClaudeBot/1.0)');

    // Recorded — umami would drop it. "ClaudeBot read the corpus" is product information for
    // an instance whose whole thesis is that an AI answers in the owner's voice.
    const bots = await readEvents(request, OWNER, { include_bots: true, surface: 'reader' });
    const claudeRow = bots.find((r) => r.is_bot && r.bot_name === 'ClaudeBot');
    expect(claudeRow, 'the crawler visit must be recorded, not discarded').toBeTruthy();

    // …and kept out of every default number.
    const summary = await readSummary(request, OWNER);
    expect(summary.views).toBe(humanBefore);
    expect(summary.bots).toBeGreaterThan(0);
  });
});

// newestReaderRow —— the most recent reader event, asserting one exists rather than indexing
// into an empty array. An `undefined` row would fail every field assertion with a message that
// says nothing about the real cause: nothing was recorded at all.
async function newestReaderRow(request: APIRequestContext): Promise<MonitorEvent> {
  const rows = await readEvents(request, OWNER, { surface: 'reader' });
  const row = rows[0];
  expect(row, 'a reader view must have been recorded').toBeTruthy();
  return row as MonitorEvent;
}

// readAsVisitor —— a stranger reads the public page. Not the `request` fixture: readEvents signs
// in on it, and from then on it is the owner's own browser, which is excluded by design.
async function readAsVisitor(playwright: Playwright, path: string): Promise<void> {
  await visitAsStranger(playwright, `/api/v1/wiki/${path}`);
}

async function initOwnerWithEntry(playwright: Playwright): Promise<string> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'monitor-seed');
  const sid = await initMCP(request, token);
  const { wikiID: id } = await seedWiki(request, token, sid, {
    title: ENTRY.title, body: 'A transformer paper note.', path: ENTRY.path,
  });
  await publishEntry(request, token, sid, { genre: 'wiki', id });
  await request.dispose();
  return id;
}
