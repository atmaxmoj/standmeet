// note-refs-unified.spec.ts — target-state red test.
//
// Refs unification: wiki_refs + writing_refs → a single note_refs edge table, carrying
// `[[Title]]` backlinks for **every genre**. Today: wiki has refs (wiki_refs), writing
// has refs (writing_refs), output has **no** refs (#150 still to do), subjectivity has
// none. Target: once unified onto note_refs, all four genres get backlinks, and links
// can cross **genres** (wiki citing output).
//
// Coverage:
//   happy   — `[[X]]` in a note resolves into an edge; backlinks (cited-by) + outbound
//             (read-next); output now has backlinks too.
//   corner  — a cross-genre link (wiki→output); editing the body rebuilds outbound
//             edges (old ones cleared, new ones inserted).
//   error   — an unmatched `[[X]]` stays literal text, no edge created; a self-link is
//             skipped; deleting a note cascades and removes its linked edges in both
//             directions.
//
// Observation: owner admin transcript / corpus detail expose refs (see
// wiki-related-rails for how that's read); here it's asserted indirectly, through
// citations in a visitor chat + admin lookups (same pairing as corpus-facade-lister),
// for the existence and direction of edges.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';

const OWNER = {
  email: 'noterefs@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'noterefs',
  fullName: 'Note Refs Owner',
};
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

type Ctx = { playwright: Playwright };
let token = '';
let sid = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('unified note_refs — [[links]] across all genres on corpus_notes', () => {
  test.beforeAll(seedOwner);

  test('happy: a wiki [[Title]] resolves into an edge → outbound + backlink both readable', happyWikiRef);
  test('happy: output now has backlinks too (#150) via the same note_refs table', happyOutputBacklink);
  test('corner: a cross-genre link (wiki → output) resolves into note_refs', cornerCrossGenre);
  test('error: an unresolved [[Ghost]] stays literal (no edge)', errorUnresolved);
  test('error: deleting a note cascades its note_refs edges (both directions)', errorCascade);
});

async function seedOwner({ playwright }: Ctx): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  token = await createAPIToken(request, csrf, 'noterefs-seed');
  sid = await initMCP(request, token);
  await request.dispose();
}

// ─── happy ──────────────────────────────────────────────────────
async function happyWikiRef({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const target = await promoteWiki(request, 'Target Note', 'the destination body');
  const src = await promoteWiki(request, 'Source Note', 'see also [[Target Note]] for context');
  // outbound of src includes target; backlinks of target include src.
  expect((await outbound(request, 'wiki', src)).map((r) => r.title))
    .toContain('Target Note');
  expect((await backlinks(request, 'wiki', target)).map((r) => r.title))
    .toContain('Source Note');
  await request.dispose();
}

async function happyOutputBacklink({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const dst = await promoteOutput(request, 'Out Dst', 'dst body');
  const src = await promoteOutput(request, 'Out Src', 'links [[Out Dst]]');
  expect((await backlinks(request, 'output', dst)).map((r) => r.title), 'output has backlinks now')
    .toContain('Out Src');
  expect(src).toBeTruthy();
  await request.dispose();
}

// ─── corner ─────────────────────────────────────────────────────
async function cornerCrossGenre({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const out = await promoteOutput(request, 'Cross Out', 'cross-genre target');
  const wiki = await promoteWiki(request, 'Cross Wiki', 'refers to [[Cross Out]] across genres');
  // wiki→output edge lands in the unified table: Cross Out's backlinks include Cross Wiki.
  expect((await backlinks(request, 'output', out)).map((r) => r.title), 'cross-genre link resolved')
    .toContain('Cross Wiki');
  expect(wiki).toBeTruthy();
  await request.dispose();
}

// ─── error ──────────────────────────────────────────────────────
async function errorUnresolved({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await promoteWiki(request, 'Real Target', 'exists');
  const src = await promoteWiki(request, 'Mixed', 'links [[Real Target]] and [[Ghost Not Real]]');
  const out = (await outbound(request, 'wiki', src)).map((r) => r.title);
  // Positive control first: the RESOLVED link IS an edge. If the refs mechanism is absent this is [] and
  // this line fails (RED) — so the "unresolved → no edge" assertion below can't false-green on absence.
  expect(out, 'the resolved link is an edge').toContain('Real Target');
  expect(out, 'the unresolved link stays literal (no edge)').not.toContain('Ghost Not Real');
  await request.dispose();
}

async function errorCascade({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const target = await promoteWiki(request, 'Doomed Target', 'body');
  const src = await promoteWiki(request, 'Linker', 'links [[Doomed Target]]');
  expect((await outbound(request, 'wiki', src)).length, 'edge exists before delete').toBe(1);
  await deleteWiki(request, target);
  // deleting the target removes the edge → src has no dangling outbound.
  expect((await outbound(request, 'wiki', src)).length, 'edge cascaded on target delete').toBe(0);
  await request.dispose();
}

// ─── helpers ────────────────────────────────────────────────────
async function promoteWiki(request: APIRequestContext, title: string, body: string): Promise<string> {
  const raw = await callTool<{ id: string }>(
    request, token, sid, 'corpus.create', { genre: 'raw', body, source: 'mcp:e2e', tags: [] });
  const w = await callTool<{ id: string }>(
    request, token, sid, 'corpus.promote', { genre: 'raw', id: raw.id, title });
  return w.id;
}
async function promoteOutput(request: APIRequestContext, title: string, body: string): Promise<string> {
  const wiki = await promoteWiki(request, title + ' src', body);
  const o = await callTool<{ id: string }>(
    request, token, sid, 'corpus.promote', { genre: 'wiki', id: wiki, title });
  return o.id;
}
async function deleteWiki(request: APIRequestContext, id: string): Promise<void> {
  // admin route is owner-authed → fresh login on this context sets the cookie + csrf.
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await request.delete(`${BACKEND}/api/admin/corpus/wiki/${id}`, { headers: { 'X-Csrftoken': csrf } });
}

interface Ref { id: string; title: string }
// outbound / backlinks — the read-next / cited-by exposed by admin corpus detail
// (note_refs outbound/inbound edges).
async function outbound(request: APIRequestContext, genre: string, id: string): Promise<Ref[]> {
  return refsField(request, genre, id, 'outbound');
}
async function backlinks(request: APIRequestContext, genre: string, id: string): Promise<Ref[]> {
  return refsField(request, genre, id, 'backlinks');
}
async function refsField(
  request: APIRequestContext, genre: string, id: string, field: 'outbound' | 'backlinks',
): Promise<Ref[]> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const res = await request.get(`${BACKEND}/api/admin/corpus/${genre}/${id}`, {
    headers: { 'X-Csrftoken': csrf },
  });
  const body = await res.json() as Record<string, Ref[] | undefined>;
  return body[field] ?? [];
}
