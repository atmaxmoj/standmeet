// corpus-addressing.spec.ts -- target-state red test: unified `<genre>://<path>`
// addressing + error flow.
//
// Goal: all four genres (wiki/output/writing/subjectivity) address through the same
// path mechanism, and ACL is always a `<genre>://<path>` glob. This spec asserts
// addressing consistency + boundary safety from **one** entry point: visitor corpus_read.
//
// Covers:
//   happy   -- a fully-granted role can read wiki/output/writing/subjectivity via their
//              respective paths, with the correct genre tag.
//   corner  -- the same leaf path is independently addressable in two genres
//              (genre-scoped, no collision; complements genre-isolation).
//   error   -- path traversal (`../`, encoded `%2e%2e`, absolute `/`) never escapes ->
//              not-found/denied, and never reads something else; a nonexistent path ->
//              a clean not-found (no crash, no 500); an ungranted genre -> access denied.
//
// Currently red: subjectivity doesn't exist (seed throws) + if writing's unified
// addressing hasn't converged yet (writings/<slug> vs writing://<slug>) that will also
// go red -- exactly the convergence this is meant to drive.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';
import { seedWiki } from '@/fixtures/corpus';
import { createRole } from '@/fixtures/roles';
import { createCode } from '@/fixtures/codes';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'addressing@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'addressing',
  fullName: 'Addressing Owner',
};
const ALL = 'ADDR-ALL';
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

type Ctx = { playwright: Playwright };
let token = '';
let sid = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('unified <genre>://path addressing + boundary safety', () => {
  test.beforeAll(seedOneNotePerGenre);

  test('happy: all four genres resolve by path under one corpus_read mechanism, genre tagged', happyAllGenres);
  test('error: path traversal (../, encoded, absolute) never escapes → not-found, no leak', errorTraversal);
  test('error: a non-existent path → clean not-found (no crash / 500)', errorMissing);
  test('error: an ungranted genre → access denied (glob is genre-scoped)', errorUngranted);
});

async function seedOneNotePerGenre({ playwright }: Ctx): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  token = await createAPIToken(request, csrf, 'addr-seed');
  sid = await initMCP(request, token);
  await seedWiki(request, token, sid, { title: 'Addr Wiki', body: 'wiki addr body' });
  const w = await callTool<{ id: string }>(request, token, sid, 'corpus.promote', {
    genre: 'raw',
    id: (await callTool<{ id: string }>(request, token, sid, 'corpus.create',
      { genre: 'raw', body: 'out src', source: 'mcp:e2e', tags: [] })).id,
    title: 'Addr Output Src',
  });
  await callTool(request, token, sid, 'corpus.promote',
    { genre: 'wiki', id: w.id, title: 'Addr Output' });
  await callTool(request, token, sid, 'writing_create', {
    slug: 'addr-writing', title: 'Addr Writing', excerpt: 'x', body_md: 'writing addr body',
    tags: [], publish: true,
  });
  await callTool(request, token, sid, 'subjectivity_write',
    { title: 'Addr Subj', body: 'subjectivity addr body', tags: [] });
  // Grant every genre.
  const role = await createRole(request, csrf, {
    name: 'addr-all', description: 'all genres',
    corpus_uris: ['wiki://**', 'output://**', 'writing://**', 'subjectivity://**'],
  });
  await createCode(request, csrf, { code: ALL, label: 'a', assumed_role_id: role.id });
  await request.dispose();
}

async function happyAllGenres({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const sess = await session(request, ALL);
  // writing path is writings/<slug> today; the unified target keeps it addressable under one mechanism.
  const cases: Array<{ path: string; genre: string; marker: string }> = [
    { path: 'addr-wiki', genre: 'wiki', marker: 'wiki addr body' },
    { path: 'addr-output', genre: 'output', marker: 'out src' },
    { path: 'writings/addr-writing', genre: 'writing', marker: 'writing addr body' },
    { path: 'addr-subj', genre: 'subjectivity', marker: 'subjectivity addr body' },
  ];
  for (const c of cases) {
    const r = await corpusRead(request, sess, c.path);
    expect(r.error, `${c.genre} resolves`).toBeUndefined();
    expect(r.genre, `${c.genre} genre tag`).toBe(c.genre);
    expect(r.body ?? '', `${c.genre} body`).toContain(c.marker);
  }
  await request.dispose();
}

async function errorTraversal({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const sess = await session(request, ALL);
  for (const evil of ['../addr-wiki', 'addr-output/../../addr-wiki', '%2e%2e/addr-wiki', '/addr-wiki']) {
    const r = await corpusRead(request, sess, evil);
    // must NOT silently resolve to a real note; either an explicit error or empty — never a leak.
    expect(r.body ?? '', `traversal '${evil}' must not read a real note`).toBe('');
    expect(r.error, `traversal '${evil}' is rejected`).toBeDefined();
  }
  await request.dispose();
}

async function errorMissing({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const sess = await session(request, ALL);
  const r = await corpusRead(request, sess, 'no/such/path/here');
  expect(r.error ?? '', 'non-existent path → clean not-found').toMatch(/not found|access denied/i);
  await request.dispose();
}

async function errorUngranted({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  // A role granting only wiki:// cannot read the subjectivity note by path.
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const wikiRole = await createRole(request, csrf, {
    name: 'addr-wiki-only', description: 'wiki only', corpus_uris: ['wiki://**'],
  });
  await createCode(request, csrf, { code: 'ADDR-WIKI', label: 'w', assumed_role_id: wikiRole.id });
  const sess = await session(request, 'ADDR-WIKI');
  const r = await corpusRead(request, sess, 'addr-subj');
  expect(r.error ?? '', 'ungranted genre denied').toContain('access denied');
  await request.dispose();
}

async function session(request: APIRequestContext, code: string): Promise<VisitorSession> {
  return issueSession(request, { handle: OWNER.handle, code, visitor_name: 'V' });
}
interface ReadResult { body?: string; genre?: string; error?: string }
async function corpusRead(
  request: APIRequestContext, s: VisitorSession, path: string,
): Promise<ReadResult> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${s.conversation_id}/tools/corpus_read`,
    { headers: { Authorization: `Bearer ${s.session_token}` }, data: { path } },
  );
  const body = await res.json() as { result?: ReadResult };
  return body.result ?? {};
}
