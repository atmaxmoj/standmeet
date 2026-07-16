// sync-h-reconcile.spec.ts —— H. 幂等 + reconcile(目标态红,同步状态机)。
// 决策默认:改名=孤儿(③)· 跨-genre 移动=就地改 genre(④)· 部分上传绝不删(⑤;整vault同步会 prune,
// 见 sync-authoritative-prune)。
// 关键容错:partial-never-delete · vault-is-the-source · 整批解析(forward-ref)· 导两次同态。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { login as loginAPI } from '@/fixtures/admin';
import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import {
  BACKEND, claimSyncOwner, syncOwner, syncSession, syncRead, adminGenreList, adminNoteRefs,
  type SyncOwner,
} from '@/fixtures/vault-sync';

type Ctx = { playwright: Playwright };
const OWNER: SyncOwner = syncOwner('h');
const md = (body: string): string => makeVaultMD({ publish: true }, body);

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('sync H · idempotency + reconcile', () => {
  test.beforeEach(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await claimSyncOwner(request, OWNER);
    await request.dispose();
  });

  // ── H2 re-import outcomes ──
  test('outcome: re-importing an unchanged note → skipped', reimportUnchangedSkip);
  test('outcome: a changed body → updated (single row)', changedBodyUpdate);
  test('outcome: a new note → created', newNoteCreated);
  // ── H3 rename / move ──
  test('move: same-genre move deeper → re-parented, new path resolves, old gone', moveDeeperReparent);
  test('move: cross-genre move (wiki→subjectivity) → genre updated in place', crossGenreMove);
  test('rename: renaming a file (new slug) → new note (orphan default), no crash', renameOrphans);
  // ── H4 conflict (web ↔ vault) ──
  test('conflict: the vault is the source — a re-sync replaces a web edit', vaultIsTheSource);
  // ── H5 deletion / partial (CRITICAL) ──
  test('partial: a partial upload NEVER deletes notes it did not include', partialNeverDeletes);
  test('partial: re-uploading a subset leaves the rest intact', subsetKeepsRest);
  // ── H6 idempotency ──
  test('idempotent: importing the same vault twice → identical state, no dup notes', importTwiceSameState);
  test('idempotent: re-import does not duplicate note_refs edges', reimportNoDupEdges);
  // ── H7 batch-order independence ──
  test('batch: [[X]] where X appears LATER in the same batch still resolves', forwardRefSameBatch);
  test('batch: a folder-note uploaded after its children still forms the tree', folderNoteAfterChildren);
});

async function sess(request: APIRequestContext) {
  return syncSession(request, OWNER);
}
// adminUpdateWiki —— web 端就地编辑 body(**保持 title** = filename 派生的身份;改了 title 就成了另一条)。
async function adminUpdateWiki(
  request: APIRequestContext, id: string, title: string, body: string,
): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await request.patch(`${BACKEND}/api/admin/corpus/wiki/${id}`, {
    headers: { 'X-Csrftoken': csrf },
    data: { title, body, tags: [], parent_id: null, show_as_source: true },
  });
}
async function wikiId(request: APIRequestContext, title: string): Promise<string> {
  const list = await adminGenreList(request, OWNER, 'wiki');
  return list.find((n) => n.title === title)?.id ?? '';
}

async function reimportUnchangedSkip({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const files = [{ rel: 'wiki/stable.md', body: md('same') }];
  await uploadVault(request, OWNER, files);
  const second = await uploadVault(request, OWNER, files);
  expect(second.created, 'unchanged re-import creates nothing').toBe(0);
  expect(second.skipped, 'unchanged → skipped').toBeGreaterThan(0);
  await request.dispose();
}

async function changedBodyUpdate({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'wiki/evolving.md', body: md('v1') }]);
  const second = await uploadVault(request, OWNER, [{ rel: 'wiki/evolving.md', body: md('v2 CHANGED') }]);
  expect(second.updated, 'changed body → updated').toBeGreaterThan(0);
  expect((await syncRead(request, await sess(request), 'evolving')).body ?? '').toContain('v2 CHANGED');
  const list = await adminGenreList(request, OWNER, 'wiki');
  expect(list.filter((n) => n.title === 'evolving').length, 'single row, not duplicated').toBe(1);
  await request.dispose();
}

async function newNoteCreated({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'wiki/first.md', body: md('a') }]);
  const second = await uploadVault(request, OWNER, [
    { rel: 'wiki/first.md', body: md('a') },
    { rel: 'wiki/second.md', body: md('b') },
  ]);
  expect(second.created, 'new note created').toBe(1);
  await request.dispose();
}

async function moveDeeperReparent({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'wiki/loose-leaf.md', body: md('leaf') }]);
  // moved under a new folder → new source_path, same identity → re-parented.
  await uploadVault(request, OWNER, [
    { rel: 'wiki/topic/topic.md', body: md('topic node') },
    { rel: 'wiki/topic/loose-leaf.md', body: md('leaf') },
  ]);
  const s = await sess(request);
  expect((await syncRead(request, s, 'topic/loose-leaf')).body ?? '', 'new path resolves').toContain('leaf');
  expect((await syncRead(request, s, 'loose-leaf')).error ?? '', 'old path gone').toMatch(/not found|access denied/i);
  await request.dispose();
}

async function crossGenreMove({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'wiki/wandering.md', body: md('w') }]);
  // moved to subjectivity/ → genre updated in place (matched by slug/source identity).
  await uploadVault(request, OWNER, [{ rel: 'subjectivity/wandering.md', body: md('w') }]);
  expect((await syncRead(request, await sess(request), 'wandering')).genre, 'genre updated to subjectivity')
    .toBe('subjectivity');
  await request.dispose();
}

async function renameOrphans({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'wiki/oldname.md', body: md('content') }]);
  const r = await uploadVault(request, OWNER, [{ rel: 'wiki/newname.md', body: md('content') }]);
  // decision ③: rename = new note (orphan). Must not crash; new name resolves.
  expect(r.errors, 'rename tolerated').toEqual([]);
  expect((await syncRead(request, await sess(request), 'newname')).genre).toBe('wiki');
  await request.dispose();
}

// vaultIsTheSource —— the vault is the SINGLE LIVE SOURCE, so a re-sync makes the corpus equal it:
// a web edit does NOT pin a note against its own vault. (This replaces the old "web-wins" rule,
// which contradicted the vault-ingestion decision — sync means sync, there is no "who wins". To keep
// web work, export it back to the vault first, then sync.)
async function vaultIsTheSource({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'wiki/shared.md', body: md('vault original') }]);
  await adminUpdateWiki(request, await wikiId(request, 'shared'), 'shared', 'WEB EDIT');
  // re-import the vault version → the vault is the source, so it wins over the web edit.
  await uploadVault(request, OWNER, [{ rel: 'wiki/shared.md', body: md('vault original') }]);
  const body = (await syncRead(request, await sess(request), 'shared')).body ?? '';
  expect(body, 'the vault version replaces the web edit — the vault is the source').toContain('vault original');
  expect(body, 'the web edit does not survive its own vault re-sync').not.toContain('WEB EDIT');
  await request.dispose();
}

async function partialNeverDeletes({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/keep-a.md', body: md('a') },
    { rel: 'wiki/keep-b.md', body: md('b') },
  ]);
  // a partial upload of only one file must NOT delete the other.
  await uploadVault(request, OWNER, [{ rel: 'wiki/keep-a.md', body: md('a2') }]);
  const s = await sess(request);
  expect((await syncRead(request, s, 'keep-b')).genre, 'partial upload never deletes keep-b').toBe('wiki');
  await request.dispose();
}

async function subsetKeepsRest({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/one.md', body: md('1') },
    { rel: 'wiki/two.md', body: md('2') },
    { rel: 'wiki/three.md', body: md('3') },
  ]);
  await uploadVault(request, OWNER, [{ rel: 'wiki/two.md', body: md('2b') }]);
  expect((await adminGenreList(request, OWNER, 'wiki')).length, 'all three still present').toBe(3);
  await request.dispose();
}

async function importTwiceSameState({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const files = [
    { rel: 'wiki/x.md', body: md('x') },
    { rel: 'wiki/y.md', body: md('y') },
  ];
  await uploadVault(request, OWNER, files);
  await uploadVault(request, OWNER, files);
  expect((await adminGenreList(request, OWNER, 'wiki')).length, 'no duplicate notes').toBe(2);
  await request.dispose();
}

async function reimportNoDupEdges({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const files = [
    { rel: 'wiki/dst.md', body: md('dst') },
    { rel: 'wiki/src.md', body: md('links [[dst]]') },
  ];
  await uploadVault(request, OWNER, files);
  await uploadVault(request, OWNER, files);
  const out = (await adminNoteRefs(request, OWNER, 'wiki', 'src')).outbound;
  expect(out.filter((t) => t === 'dst').length, 're-import does not duplicate the edge').toBe(1);
  await request.dispose();
}

async function forwardRefSameBatch({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  // src references target that appears LATER in the same upload — whole-batch resolution.
  await uploadVault(request, OWNER, [
    { rel: 'wiki/forward-src.md', body: md('see [[forward-dst]]') },
    { rel: 'wiki/forward-dst.md', body: md('the target') },
  ]);
  expect((await adminNoteRefs(request, OWNER, 'wiki', 'forward-src')).outbound, 'forward-ref resolved')
    .toContain('forward-dst');
  await request.dispose();
}

async function folderNoteAfterChildren({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  // child listed before its folder-note in the batch — tree still forms.
  await uploadVault(request, OWNER, [
    { rel: 'wiki/late/leaf.md', body: md('leaf first') },
    { rel: 'wiki/late/late.md', body: md('folder-note last') },
  ]);
  expect((await syncRead(request, await sess(request), 'late/leaf')).body ?? '', 'tree forms regardless of order')
    .toContain('leaf first');
  await request.dispose();
}
