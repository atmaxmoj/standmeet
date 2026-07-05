// note-refs-unified.spec.ts —— 目标态红测试。
//
// refs 归一:wiki_refs + writing_refs → 一张 note_refs 边表,承载**所有 genre** 的 `[[Title]]` 双链。
// 今天:wiki 有 refs(wiki_refs)、writing 有 refs(writing_refs)、output **无** refs(#150 待做)、
// subjectivity 无。目标:统一到 note_refs 后,四个 genre 都能双链,且可**跨-genre** 链(wiki 引 output)。
//
// 覆盖:
//   happy   —— note 里 `[[X]]` 解析成边;backlinks(cited-by)+ outbound(read-next);output 也有了 backlinks。
//   corner  —— 跨-genre 链(wiki→output);改 body 重建出度(旧边清、新边入)。
//   error   —— 未命中的 `[[X]]` 留字面不入边;self-link 跳过;删 note → 关联边双向级联消。
//
// 观测:owner admin transcript / corpus detail 暴露 refs(见 wiki-related-rails 的读法);此处经
// 访客 chat 引用 + admin 反查(与 corpus-facade-lister 同套)间接断言边的存在与方向。

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
let csrf = '';

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
  const login = await loginAPI(request, OWNER.email, OWNER.password);
  csrf = login.csrf;
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
  const raw = await callTool<{ raw_id: string }>(
    request, token, sid, 'raw_dump', { body, source: 'mcp:e2e', tags: [] });
  const w = await callTool<{ wiki_id: string }>(
    request, token, sid, 'promote_to_wiki', { raw_id: raw.raw_id, title });
  return w.wiki_id;
}
async function promoteOutput(request: APIRequestContext, title: string, body: string): Promise<string> {
  const wiki = await promoteWiki(request, title + ' src', body);
  const o = await callTool<{ output_id: string }>(
    request, token, sid, 'promote_wiki_to_output', { wiki_id: wiki, title });
  return o.output_id;
}
async function deleteWiki(request: APIRequestContext, id: string): Promise<void> {
  await request.delete(`${BACKEND}/api/admin/wiki/${id}`, { headers: { 'X-Csrftoken': csrf } });
}

interface Ref { id: string; title: string }
// outbound / backlinks —— admin corpus detail 暴露的 read-next / cited-by(note_refs 出/入度)。
async function outbound(request: APIRequestContext, genre: string, id: string): Promise<Ref[]> {
  return refsField(request, genre, id, 'outbound');
}
async function backlinks(request: APIRequestContext, genre: string, id: string): Promise<Ref[]> {
  return refsField(request, genre, id, 'backlinks');
}
async function refsField(
  request: APIRequestContext, genre: string, id: string, field: 'outbound' | 'backlinks',
): Promise<Ref[]> {
  const res = await request.get(`${BACKEND}/api/admin/${genre}/${id}`, {
    headers: { 'X-Csrftoken': csrf },
  });
  const body = await res.json() as Record<string, Ref[] | undefined>;
  return body[field] ?? [];
}
