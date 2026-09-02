// genre-isolation.spec.ts — a target-state red test.
//
// Real isolation along the genre dimension: a note belongs to exactly one genre; a
// query/search/authorization scoped to a genre must never leak into another genre.
// This is the guard against "one shared base table + a genre column" degrading into
// one big soup — all four genres share a table, but queries/ACL must be genre-scoped.
//
// Coverage:
//   happy   — the same keyword is seeded into all four genres (wiki/output/writing/
//             subjectivity); a role granted everything searches and finds 4 hits,
//             each tagged with the correct genre (wiki→'wiki', subjectivity→'subjectivity').
//   error   — a role granted only wiki:// searches the same keyword →
//             **only** the wiki hit comes back; output/subjectivity are blocked by
//             genre-scoped ACL (no leak just because they share a table and a keyword).
//
// Currently red: subjectivity doesn't exist yet → subjectivity_write throws at the
// seed step.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';
import { seedWiki } from '@/fixtures/corpus';
import { createRole } from '@/fixtures/roles';
import { createCode } from '@/fixtures/codes';
// Use the shared one — this file used to keep its own copy, so every change to
// corpus_search's wiring broke in four places, and none of them were absorbed by the
// fixture.
import { search } from '@/fixtures/retrieval';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'genreiso@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'genreiso',
  fullName: 'Genre Isolation Owner',
};
const KEY = 'isolationqx';
const ALL_CODE = 'ISO-ALL';
const WIKI_CODE = 'ISO-WIKI';
type Ctx = { playwright: Playwright };
let token = '';
let sid = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('genre isolation — genre-scoped query/ACL over the shared corpus_notes base', () => {
  test.beforeAll(seedFourGenres);

  test('happy: one keyword across wiki+output+writing+subjectivity → all-granted role finds all 4, genres correct',
    happyAllFour);
  test('error: a wiki-only role finds ONLY the wiki one (genre-scoped ACL, no cross-genre leak)',
    errorGenreScoped);
});

async function seedFourGenres({ playwright }: Ctx): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  token = await createAPIToken(request, csrf, 'iso-seed');
  sid = await initMCP(request, token);
  // Same keyword in four genres.
  await seedWiki(request, token, sid, { title: 'Iso Wiki', body: `wiki note ${KEY}` });
  const w = await callTool<{ id: string }>(request, token, sid, 'corpus.promote', {
    genre: 'raw',
    id: (await callTool<{ id: string }>(request, token, sid, 'corpus.create',
      { genre: 'raw', body: `output src ${KEY}`, source: 'mcp:e2e', tags: [] })).id,
    title: 'Iso Output Src',
  });
  await callTool(request, token, sid, 'corpus.promote',
    { genre: 'wiki', id: w.id, title: 'Iso Output' });
  await callTool(request, token, sid, 'subjectivity_write',
    { title: 'Iso Subj', body: `subjectivity note ${KEY}`, tags: [] });
  await callTool(request, token, sid, 'writing_create', {
    slug: 'iso-writing', title: 'Iso Writing', excerpt: 'x',
    body_md: `writing note ${KEY}`, tags: [], publish: true,
  });
  // Two roles: all-genres and wiki-only.
  const all = await createRole(request, csrf, {
    name: 'iso-all', description: 'all genres',
    corpus_uris: ['wiki://**', 'output://**', 'writing://**', 'subjectivity://**'],
  });
  await createCode(request, csrf, { code: ALL_CODE, label: 'a', assumed_role_id: all.id });
  const wikiOnly = await createRole(request, csrf, {
    name: 'iso-wiki', description: 'wiki only', corpus_uris: ['wiki://**'],
  });
  await createCode(request, csrf, { code: WIKI_CODE, label: 'w', assumed_role_id: wikiOnly.id });
  await request.dispose();
}

async function happyAllFour({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const sess = await session(request, ALL_CODE);
  const hits = await search(request, sess, KEY);
  const genres = new Set(hits.map((h) => h.genre));
  expect(genres.has('wiki'), 'wiki hit').toBe(true);
  expect(genres.has('output'), 'output hit').toBe(true);
  expect(genres.has('writing'), 'writing hit — writing on the unified base').toBe(true);
  expect(genres.has('subjectivity'), 'subjectivity hit — genre tag correct').toBe(true);
  await request.dispose();
}

async function errorGenreScoped({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const sess = await session(request, WIKI_CODE);
  const hits = await search(request, sess, KEY);
  expect(hits.length, 'wiki-only role sees exactly one genre').toBeGreaterThan(0);
  expect(hits.every((h) => h.genre === 'wiki'), 'no output/subjectivity leak into a wiki-only role')
    .toBe(true);
  await request.dispose();
}

async function session(request: APIRequestContext, code: string): Promise<VisitorSession> {
  return issueSession(request, { handle: OWNER.handle, code, visitor_name: 'V' });
}
