// vault-sync-face.spec.ts —— sync face 目标态红测试(现在红:import 还是把所有 .md 拍平进 writings,
// 不按 folder → genre / folder-tree 路由)。例子取自真实 vault 的约定(_templates 里的 import contract):
//   - 顶层 folder = genre:  wiki/… → genre 'wiki'；subjectivity/… → 'subjectivity'
//   - 文件名 = title(frontmatter 不写 title/slug/path —— 都来自 filename + vault path)
//   - publish: false（默认）→ importer 跳过；true → 入库
//   - body 里 `[[slug]]` / `[[Title]]` → note_refs（跨-genre）;cross_refs / aliases 忽略
//
// 覆盖(先挑不含"嵌套折叠"歧义的清楚 case;嵌套 folder→tree 的路径模型是待定的设计决策，见 spec 末注)。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import { createRole } from '@/fixtures/roles';
import { createCode } from '@/fixtures/codes';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'vaultsync@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'vaultsync',
  fullName: 'Vault Sync Owner',
};
const CODE = 'VAULTSYNC-1';
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

type Ctx = { playwright: Playwright };

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('vault sync face — folder tree → corpus_notes (genre from top folder)', () => {
  test.beforeAll(claimOwner);

  test('happy: a wiki/ note syncs as genre=wiki, addressable by its filename', wikiFolderToGenre);
  test('happy: a subjectivity/ note syncs as genre=subjectivity', subjectivityFolderToGenre);
  test('happy: raw/ notes sync into the raw inbox too', rawSynced);
  test('tree: folder-notes are nodes; nested note resolves at its folder path', nodeTreeFolderNotes);
  test('tolerance: a folder without a folder-note still yields a resolvable nested path', missingFolderNoteTolerated);
  test('gate: publish:false is skipped; publish:true is imported', publishGate);
  test('links: body [[slug]] resolves into note_refs (cross-genre capable)', bodyLinksToRefs);
  test('ignored: frontmatter title/cross_refs dropped; title == filename', ignoredFrontmatter);
  test('hidden: dotfiles/dirs (.obsidian/.git) + _templates are skipped', hiddenFilesSkipped);
});
// Note: bidirectional (export of corpus_notes back to a vault zip + reconciliation) is the larger second
// half of the sync face — its own spec (needs zip inspection + web-edit-wins/vault-edit-wins rules).

async function claimOwner({ playwright }: Ctx): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await createAPIToken(request, csrf, 'vaultsync-seed');
  // A role that grants every genre so corpus_read can reach synced notes of any genre.
  const role = await createRole(request, csrf, {
    name: 'vault-all', description: 'all genres',
    corpus_uris: ['wiki://**', 'output://**', 'writing://**', 'subjectivity://**'],
  });
  await createCode(request, csrf, { code: CODE, label: 'v', assumed_role_id: role.id });
  await request.dispose();
}

// wikiFolderToGenre —— wiki/ashby.md → genre 'wiki', 按 filename 'ashby' 寻址。
async function wikiFolderToGenre({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/ashby.md', body: makeVaultMD({ publish: true, tags: ['node'] }, 'Ashby on variety.') },
  ]);
  const sess = await session(request);
  const read = await corpusRead(request, sess, 'ashby');
  expect(read.genre, 'top folder wiki/ → genre wiki').toBe('wiki');
  expect(read.body ?? '', 'body synced').toContain('Ashby on variety');
  await request.dispose();
}

async function subjectivityFolderToGenre({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'subjectivity/how-i-decide.md', body: makeVaultMD({ publish: true }, 'I optimize for reversibility.') },
  ]);
  const sess = await session(request);
  const read = await corpusRead(request, sess, 'how-i-decide');
  expect(read.genre, 'subjectivity/ → genre subjectivity').toBe('subjectivity');
  await request.dispose();
}

async function publishGate({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/kept.md', body: makeVaultMD({ publish: true }, 'kept') },
    { rel: 'wiki/draft.md', body: makeVaultMD({ publish: false }, 'draft not pushed') },
  ]);
  const sess = await session(request);
  expect((await corpusRead(request, sess, 'kept')).genre, 'publish:true imported').toBe('wiki');
  expect((await corpusRead(request, sess, 'draft')).error ?? '', 'publish:false skipped')
    .toMatch(/not found|access denied/i);
  await request.dispose();
}

async function bodyLinksToRefs({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/good-regulator-theorem.md', body: makeVaultMD({ publish: true }, 'the theorem') },
    { rel: 'wiki/ashby.md', body: makeVaultMD({ publish: true }, 'see [[good-regulator-theorem]]') },
  ]);
  // outbound of ashby includes good-regulator-theorem (resolved by filename/slug).
  const outbound = await adminOutbound(request, 'wiki', 'ashby');
  expect(outbound, 'body [[slug]] became a note_ref edge').toContain('good-regulator-theorem');
  await request.dispose();
}

async function ignoredFrontmatter({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    {
      rel: 'wiki/order-theory.md',
      body: makeVaultMD(
        { publish: true, title: 'SHOULD BE IGNORED', cross_refs: ['x'], aliases: ['y'] },
        'order theory body',
      ),
    },
  ]);
  const sess = await session(request);
  // title comes from the filename, not the frontmatter title.
  const read = await corpusRead(request, sess, 'order-theory');
  expect(read.genre, 'imported').toBe('wiki');
  expect(read.title, 'title == filename (frontmatter title ignored)').toBe('order-theory');
  await request.dispose();
}

async function rawSynced({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'raw/scratch-thought.md', body: makeVaultMD({ tags: ['seed'] }, 'a rough raw thought RAWSYNCKW') },
  ]);
  const bodies = await adminBodies(request, 'raw');
  expect(bodies.some((b) => b.includes('RAWSYNCKW')), 'raw/ note synced into the raw inbox').toBe(true);
  await request.dispose();
}

// nodeTreeFolderNotes —— folder-notes ARE the nodes（cybernetics/cybernetics.md = "cybernetics" 节点）。
async function nodeTreeFolderNotes({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/cybernetics/cybernetics.md', body: makeVaultMD({ publish: true }, 'the field') },
    { rel: 'wiki/cybernetics/theory/theory.md', body: makeVaultMD({ publish: true }, 'theory node') },
    { rel: 'wiki/cybernetics/theory/ashby.md', body: makeVaultMD({ publish: true }, 'ashby leaf') },
  ]);
  const sess = await session(request);
  const read = await corpusRead(request, sess, 'cybernetics/theory/ashby');
  expect(read.genre, 'nested note resolves via the folder-note tree').toBe('wiki');
  expect(read.body ?? '').toContain('ashby leaf');
  await request.dispose();
}

// missingFolderNoteTolerated —— 'orbit/' 没有 orbit.md folder-note → 容忍:嵌套 path 仍解析得到。
async function missingFolderNoteTolerated({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/math/orbit/kepler.md', body: makeVaultMD({ publish: true }, 'kepler leaf') },
  ]);
  const sess = await session(request);
  const read = await corpusRead(request, sess, 'math/orbit/kepler');
  expect(read.genre, 'missing intermediate folder-note tolerated').toBe('wiki');
  expect(read.body ?? '').toContain('kepler leaf');
  await request.dispose();
}

async function hiddenFilesSkipped({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/real-note.md', body: makeVaultMD({ publish: true }, 'real') },
    { rel: '.obsidian/app.json', body: '{"x":1}' },
    { rel: '.git/config', body: '[core]' },
    { rel: '_templates/note.md', body: makeVaultMD({ publish: true }, 'template scaffold') },
  ]);
  const sess = await session(request);
  expect((await corpusRead(request, sess, 'real-note')).genre, 'real note imported').toBe('wiki');
  // the template + dotfiles must NOT become notes.
  expect((await corpusRead(request, sess, 'note')).error ?? '', '_templates/ + dotfiles skipped')
    .toMatch(/not found|access denied/i);
  await request.dispose();
}

// ─── helpers ────────────────────────────────────────────────────
async function session(request: APIRequestContext): Promise<VisitorSession> {
  return issueSession(request, { handle: OWNER.handle, code: CODE, visitor_name: 'V' });
}

interface ReadResult { body?: string; genre?: string; title?: string; error?: string }
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

// adminBodies —— owner admin 列表里某 genre 的所有 body（raw 无 title，按 body 断言同步）。
async function adminBodies(request: APIRequestContext, genre: string): Promise<string[]> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const res = await request.get(`${BACKEND}/api/admin/${genre}`, { headers: { 'X-Csrftoken': csrf } });
  const list = await res.json() as Array<{ body?: string }>;
  return list.map((n) => n.body ?? '');
}

async function adminOutbound(
  request: APIRequestContext, genre: string, filename: string,
): Promise<string[]> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  // admin list to find the note id by title (filename), then its detail's outbound.
  const listRes = await request.get(`${BACKEND}/api/admin/${genre}`, { headers: { 'X-Csrftoken': csrf } });
  const list = await listRes.json() as Array<{ id: string; title: string }>;
  const hit = list.find((n) => n.title === filename);
  if (!hit) return [];
  const detRes = await request.get(`${BACKEND}/api/admin/${genre}/${hit.id}`, {
    headers: { 'X-Csrftoken': csrf },
  });
  const det = await detRes.json() as { outbound?: Array<{ title: string }> };
  return (det.outbound ?? []).map((r) => r.title);
}
