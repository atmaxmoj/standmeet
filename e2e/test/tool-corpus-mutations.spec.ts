// tool-corpus-mutations.spec.ts —— the **genre matrix** for an owner manipulating the
// corpus through MCP.
//
// Business story: the owner tells their own AI in Claude Code "rename this wiki
// entry", "promote this raw entry", "create an output" — the AI calls corpus.*, which
// converges through the choke point into the domain. Reopening the panel shows the
// same result.
//
// genre is **a parameter**, not three separate tool sets. Before normalization, the
// two surfaces had unequal coverage: the panel could create wiki / output and edit
// raw, while MCP only had raw_dump / update_wiki / update_output / delete_wiki /
// delete_output / promote_*. In other words, the owner **couldn't create a wiki entry
// or edit a raw entry** from Claude Code. The four cases marked "the filled-in cells"
// below are exactly what was missing — they previously had zero coverage.

import type { APIRequestContext, Playwright } from '@playwright/test';

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { BACKEND } from '@/fixtures/vault-sync';

const OWNER = {
  email: 'corpus-mut@example.com', password: 'correct-horse-battery-staple',
  handle: 'corpus-mut', fullName: 'Corpus Mutations Owner',
};

// The shape a corpus entry takes on each surface (fields that don't apply are zero
// values).
interface CorpusItem {
  id: string;
  genre: string;
  title: string;
  body?: string;
  preview: string;
  status?: string;
  tags: string[];
  source_raw_ids: string[];
  source_wiki_ids: string[];
  published: boolean;
}
interface DeleteResp { id: string; genre: string; deleted: boolean }

let sid: string;
let apiToken: string;
let wikiID: string;
let outputID: string;

async function seedCorpusMut(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  apiToken = await createAPIToken(request, csrf, 'corpus-mut-token');
  sid = await initMCP(request, apiToken);

  const raw = await createEntry(request, { genre: 'raw', body: 'seed raw body', tags: ['e3'] });
  const wiki = await promote(request, { genre: 'raw', id: raw.id, title: 'Seed wiki' });
  wikiID = wiki.id;
  const output = await promote(request, { genre: 'wiki', id: wikiID, title: 'Seed output' });
  outputID = output.id;
  await request.dispose();
}

// ── Small helpers: one per verb ────────────────────────────────────────────

function createEntry(
  request: APIRequestContext, args: Record<string, unknown>,
): Promise<CorpusItem> {
  return callTool<CorpusItem>(request, apiToken, sid, 'corpus.create', args);
}

function promote(
  request: APIRequestContext, args: Record<string, unknown>,
): Promise<CorpusItem> {
  return callTool<CorpusItem>(request, apiToken, sid, 'corpus.promote', args);
}

function updateEntry(
  request: APIRequestContext, args: Record<string, unknown>,
): Promise<CorpusItem> {
  return callTool<CorpusItem>(request, apiToken, sid, 'corpus.update', args);
}

function listGenre(request: APIRequestContext, genre: string): Promise<CorpusItem[]> {
  return callTool<CorpusItem[]>(request, apiToken, sid, 'corpus.list', { genre });
}

async function titleInList(
  request: APIRequestContext, genre: string, id: string,
): Promise<string | undefined> {
  const list = await listGenre(request, genre);
  return list.find((it) => it.id === id)?.title;
}

// ── The original four: edit / delete wiki and output ─────────────────────────────────

async function testUpdateWiki(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const resp = await updateEntry(request, {
    genre: 'wiki', id: wikiID, title: 'Renamed wiki',
    body: 'New body content', tags: ['e3', 'renamed'],
  });
  expect(resp.id).toBe(wikiID);
  expect(resp.title).toBe('Renamed wiki');
  expect(await titleInList(request, 'wiki', wikiID)).toBe('Renamed wiki');
  await request.dispose();
}

async function testUpdateOutput(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const resp = await updateEntry(request, {
    genre: 'output', id: outputID, title: 'Renamed output',
    body: 'Polished new body', tags: ['e3', 'renamed'],
  });
  expect(resp.id).toBe(outputID);
  expect(resp.title).toBe('Renamed output');
  expect(await titleInList(request, 'output', outputID)).toBe('Renamed output');
  await request.dispose();
}

async function testDeleteWiki(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const raw = await createEntry(request, { genre: 'raw', body: 'will-be-deleted raw' });
  const doomed = await promote(request, { genre: 'raw', id: raw.id, title: 'Wiki to delete' });

  const resp = await callTool<DeleteResp>(
    request, apiToken, sid, 'corpus.delete', { genre: 'wiki', id: doomed.id },
  );
  expect(resp.deleted).toBe(true);
  expect(resp.id).toBe(doomed.id);
  expect(await titleInList(request, 'wiki', doomed.id)).toBeUndefined();
  await request.dispose();
}

async function testDeleteOutput(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const raw = await createEntry(request, { genre: 'raw', body: 'output-to-delete seed' });
  const wiki = await promote(request, {
    genre: 'raw', id: raw.id, title: 'Wiki for output to delete',
  });
  const doomed = await promote(request, {
    genre: 'wiki', id: wiki.id, title: 'Output to delete',
  });

  const resp = await callTool<DeleteResp>(
    request, apiToken, sid, 'corpus.delete', { genre: 'output', id: doomed.id },
  );
  expect(resp.deleted).toBe(true);
  expect(await titleInList(request, 'output', doomed.id)).toBeUndefined();
  await request.dispose();
}

// ── The filled-in cells: the four things MCP simply didn't have before normalization ───────────────────────────

async function testCreateWikiDirectly(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const wiki = await createEntry(request, {
    genre: 'wiki', title: 'Written straight to wiki',
    body: 'no raw step', tags: ['direct'],
  });
  expect(wiki.genre).toBe('wiki');
  expect(wiki.id).toMatch(/^[0-9a-f-]{36}$/);
  // A wiki entry created directly has no source raw — that's exactly the evidence of
  // "skipping the raw step".
  expect(wiki.source_raw_ids).toEqual([]);
  expect(await titleInList(request, 'wiki', wiki.id)).toBe('Written straight to wiki');
  await request.dispose();
}

async function testCreateOutputDirectly(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const out = await createEntry(request, {
    genre: 'output', title: 'Written straight to output', body: 'shipped as-is',
  });
  expect(out.genre).toBe('output');
  expect(out.source_wiki_ids).toEqual([]);
  expect(await titleInList(request, 'output', out.id)).toBe('Written straight to output');
  await request.dispose();
}

async function testUpdateRaw(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const raw = await createEntry(request, { genre: 'raw', body: 'first thought' });
  const edited = await updateEntry(request, {
    genre: 'raw', id: raw.id, body: 'second thought', tags: ['edited'],
  });
  expect(edited.id).toBe(raw.id);
  expect(edited.body).toBe('second thought');

  const list = await listGenre(request, 'raw');
  expect(list.find((it) => it.id === raw.id)?.body).toBe('second thought');
  await request.dispose();
}

async function testDeleteRaw(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const raw = await createEntry(request, { genre: 'raw', body: 'to be deleted' });

  const resp = await callTool<DeleteResp>(
    request, apiToken, sid, 'corpus.delete', { genre: 'raw', id: raw.id },
  );
  expect(resp.deleted).toBe(true);
  // Gone from the list — and **actually gone**: raw used to go through "archiving"
  // (the row stays, a flag gets set), but that archiving never had a second half (no
  // list showing archived rows, no path to restore them), so the name corpus.delete
  // was a lie on raw. So both assertions are needed here: gone from the list, and
  // unreadable by id too.
  const list = await listGenre(request, 'raw');
  expect(list.find((it) => it.id === raw.id)).toBeUndefined();
  await expect(
    callTool(request, apiToken, sid, 'corpus.get', { genre: 'raw', id: raw.id }),
    '按 id 也读不出来 —— 只断"列表里没有"的话,软删也能过',
  ).rejects.toThrow(/not found|不存在/i);
  await request.dispose();
}

// ── Validation of genre itself ─────────────────────────────────────────────────

async function testUnknownGenre(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  await expect(
    callTool(request, apiToken, sid, 'corpus.list', { genre: 'nonsense' }),
  ).rejects.toThrow(/raw.*wiki.*output/);
  await request.dispose();
}

// adminRawRow —— reads a raw entry back through the owner-panel path. **Deliberately
// not through MCP**: `corpusItemOut` has no `flagged_private` field, so reading it
// through MCP would always come back undefined — making this assertion pass forever
// because "the field doesn't exist", proving nothing
// ([[assertion-that-cannot-fail]]).
async function adminRawRow(
  request: APIRequestContext, id: string,
): Promise<{ flagged_private?: boolean; tags?: string[] }> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const res = await request.get(`${BACKEND}/api/admin/corpus/raw`, {
    headers: { 'X-Csrftoken': csrf },
  });
  expect(res.ok(), 'precondition: the admin raw list answers').toBeTruthy();
  const body = (await res.json()) as { items?: { id: string }[] } | { id: string }[];
  const rows = (Array.isArray(body) ? body : body.items ?? []) as {
    id: string; flagged_private?: boolean; tags?: string[];
  }[];
  const row = rows.find((r) => r.id === id);
  expect(row, 'precondition: the entry is still in the raw list').toBeDefined();
  return row ?? {};
}

async function testPartialUpdateKeepsFlags(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const entry = await createEntry(request, {
    genre: 'raw', body: 'a private thought', tags: ['personal'], flagged_private: true,
  });

  // Precondition: first confirm this entry is really flagged private, or everything
  // below is asserting against thin air.
  const before = await adminRawRow(request, entry.id);
  expect(before.flagged_private, 'precondition: the entry starts out private').toBe(true);
  expect(before.tags, 'precondition: the entry starts out tagged').toContain('personal');

  // The most ordinary thing the owner's AI would do: edit only the body.
  await updateEntry(request, { genre: 'raw', id: entry.id, body: 'a private thought, reworded' });

  const after = await adminRawRow(request, entry.id);
  expect(
    after.flagged_private,
    '改正文没提到 flagged_private —— 它必须原样留着。清掉 owner 标的私密，'
    + '而且回执报成功，是一次没有回执的降级',
  ).toBe(true);
  expect(
    after.tags,
    '同一个道理：没提到 tags 就不该把 tags 清空',
  ).toContain('personal');
  await request.dispose();
}

test.describe('corpus mutations via MCP · genre 矩阵', () => {
  test.beforeAll(async ({ playwright }) => {
    await seedCorpusMut(playwright);
  });

  test('corpus.update on wiki changes title + body; the list reflects it',
    async ({ playwright }) => { await testUpdateWiki(playwright); });

  test('corpus.update on output changes title + body; the list reflects it',
    async ({ playwright }) => { await testUpdateOutput(playwright); });

  test('corpus.delete removes a wiki; the list no longer shows it',
    async ({ playwright }) => { await testDeleteWiki(playwright); });

  test('corpus.delete removes an output; the list no longer shows it',
    async ({ playwright }) => { await testDeleteOutput(playwright); });

  test('补上的格子:corpus.create writes a wiki directly, with no raw step',
    async ({ playwright }) => { await testCreateWikiDirectly(playwright); });

  test('补上的格子:corpus.create writes an output directly',
    async ({ playwright }) => { await testCreateOutputDirectly(playwright); });

  test('补上的格子:corpus.update edits a raw entry in place',
    async ({ playwright }) => { await testUpdateRaw(playwright); });

  test('补上的格子:corpus.delete really deletes a raw entry',
    async ({ playwright }) => { await testDeleteRaw(playwright); });

  test('an unknown genre is refused, naming the three that exist',
    async ({ playwright }) => { await testUnknownGenre(playwright); });

  // **Editing the body must never quietly wipe out fields it didn't mention**
  // (F-L-57).
  //
  // `corpus.update`'s schema only requires `genre` + `id`, and its description says
  // "in place" — so when the owner's AI is told "edit this raw entry's body", what it
  // sends is `{genre,id,body}`. But `FlaggedPrivate` on `corpusWriteArgs` is a **bare
  // bool**: the field being absent from the JSON means false, meaning **the owner's
  // private flag gets cleared**. tags gets wiped out the same way, and the response
  // still reports success.
  //
  // On the very same struct, `ParentID` / `ShowAsSource` / hero are already pointers,
  // each carrying a comment explaining "a bare value can't express 'not provided'" —
  // the same lesson written down three times, and fixed for only that one field each
  // time ([[lesson-not-swept-to-neighbours]]).
  //
  // And this field **is never sent back at all** on `corpusItemOut`: the AI can set
  // it, but can never read it back — so it doesn't even have the fallback of "read it
  // back and send the same value forward".
  test('editing only the body must not silently un-private a raw entry',
    async ({ playwright }) => { await testPartialUpdateKeepsFlags(playwright); });
});
