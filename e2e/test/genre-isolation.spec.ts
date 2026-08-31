// genre-isolation.spec.ts —— 目标态红测试。
//
// genre 维度真隔离:一条 note 属于且只属于一个 genre;按 genre 查/搜/授权,绝不串到别的 genre。
// 这是「统一基座 + genre 列」不退化成一锅粥的守卫 —— 四个 genre 同表,但查询/ACL 必须 genre-scoped。
//
// 覆盖:
//   happy   —— 同一 keyword 种进 wiki/output/writing/subjectivity 四 genre;全授的 role 搜到 4 条,
//              每条 genre 标签正确(wiki→'wiki', subjectivity→'subjectivity')。
//   error   —— 只授 wiki:// 的 role 搜同一 keyword → **只**返 wiki 那条;output/subjectivity 被
//              genre-scoped ACL 挡掉(不因同表、同 keyword 而泄漏)。
//
// 现在红:subjectivity 不存在 → seed 阶段 subjectivity_write 就抛。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';
import { seedWiki } from '@/fixtures/corpus';
import { createRole } from '@/fixtures/roles';
import { createCode } from '@/fixtures/codes';
// 用共享的那份 —— 这里曾经自己抄了一份，于是 corpus_search 的 wire 一改
// 就断在四个地方，而 fixture 一个都吸收不了。
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
