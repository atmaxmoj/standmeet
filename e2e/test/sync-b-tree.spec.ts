// sync-b-tree.spec.ts — B. Node tree + folder-note + tolerance (target-state red).
// A folder-note `foo/foo.md` = node foo (convention A, see backfill-folder-notes.sh).
// An intermediate segment missing its folder-note -> an empty placeholder node is
// auto-created (backfill semantics). Name collisions / excessive depth -> tolerated,
// never crashes.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import {
  claimSyncOwner, syncOwner, syncSession, syncRead, type SyncOwner,
} from '@/fixtures/vault-sync';

type Ctx = { playwright: Playwright };
const OWNER: SyncOwner = syncOwner('b');
const md = (body: string): string => makeVaultMD({ publish: true }, body);

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('sync B · node tree + folder-notes + tolerance', () => {
  test.beforeEach(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await claimSyncOwner(request, OWNER);
    await request.dispose();
  });

  // ── happy ──
  test('happy: folder-note foo/foo.md becomes node "foo", readable at foo', folderNoteIsNode);
  test('happy: nested a/b/c.md with folder-notes → tree a→b→c', nestedTree);
  // ── corner ──
  test('corner: a leaf directly under the genre root (no intermediate folder)', leafAtGenreRoot);
  test('corner: 5-level deep nesting resolves', deepNesting);
  // ── error / tolerance ──
  test('tolerance: a folder WITHOUT a folder-note still yields a resolvable nested path', missingFolderNote);
  test('tolerance: two missing intermediate folder-notes in a row', missingTwoLevels);
  test('error: a leaf named same as a sibling folder (kepler.md + kepler/) does not clobber', leafFolderNameClash);
  test('error: an over-deep path (>32 levels) is tolerated, not a crash', overDeepTolerated);
});

async function folderNoteIsNode({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/cybernetics/cybernetics.md', body: md('the field, a node') },
  ]);
  const sess = await syncSession(request, OWNER);
  const read = await syncRead(request, sess, 'cybernetics');
  expect(read.genre, 'folder-note is a node').toBe('wiki');
  expect(read.body ?? '').toContain('the field');
  await request.dispose();
}

async function nestedTree({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/cybernetics/cybernetics.md', body: md('a') },
    { rel: 'wiki/cybernetics/theory/theory.md', body: md('b') },
    { rel: 'wiki/cybernetics/theory/ashby.md', body: md('ashby leaf') },
  ]);
  const sess = await syncSession(request, OWNER);
  expect((await syncRead(request, sess, 'cybernetics/theory/ashby')).body ?? '').toContain('ashby leaf');
  await request.dispose();
}

async function leafAtGenreRoot({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'wiki/protocol.md', body: md('root leaf') }]);
  const sess = await syncSession(request, OWNER);
  expect((await syncRead(request, sess, 'protocol')).body ?? '').toContain('root leaf');
  await request.dispose();
}

async function deepNesting({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/a/a.md', body: md('a') },
    { rel: 'wiki/a/b/b.md', body: md('b') },
    { rel: 'wiki/a/b/c/c.md', body: md('c') },
    { rel: 'wiki/a/b/c/d/d.md', body: md('d') },
    { rel: 'wiki/a/b/c/d/leaf.md', body: md('deep leaf') },
  ]);
  const sess = await syncSession(request, OWNER);
  expect((await syncRead(request, sess, 'a/b/c/d/leaf')).body ?? '').toContain('deep leaf');
  await request.dispose();
}

async function missingFolderNote({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  // 'orbit/' has NO orbit.md → tolerance auto-creates the node.
  await uploadVault(request, OWNER, [
    { rel: 'wiki/math/math.md', body: md('math node') },
    { rel: 'wiki/math/orbit/kepler.md', body: md('kepler leaf') },
  ]);
  const sess = await syncSession(request, OWNER);
  expect((await syncRead(request, sess, 'math/orbit/kepler')).body ?? '', 'missing folder-note tolerated')
    .toContain('kepler leaf');
  await request.dispose();
}

async function missingTwoLevels({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  // neither 'x/' nor 'y/' has a folder-note.
  await uploadVault(request, OWNER, [{ rel: 'wiki/x/y/z.md', body: md('z leaf') }]);
  const sess = await syncSession(request, OWNER);
  expect((await syncRead(request, sess, 'x/y/z')).body ?? '', 'two missing levels tolerated')
    .toContain('z leaf');
  await request.dispose();
}

async function leafFolderNameClash({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  // kepler.md (a leaf) AND kepler/ (a folder with children) at the same level.
  await uploadVault(request, OWNER, [
    { rel: 'wiki/orbit/orbit.md', body: md('orbit node') },
    { rel: 'wiki/orbit/kepler.md', body: md('kepler the leaf') },
    { rel: 'wiki/orbit/kepler/kepler.md', body: md('kepler the folder-note') },
    { rel: 'wiki/orbit/kepler/laws.md', body: md('laws under kepler') },
  ]);
  const sess = await syncSession(request, OWNER);
  // the folder-note wins the 'orbit/kepler' node; its child resolves; no crash / no clobber.
  expect((await syncRead(request, sess, 'orbit/kepler/laws')).body ?? '', 'child of the kepler folder')
    .toContain('laws under kepler');
  await request.dispose();
}

async function overDeepTolerated({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const segs = Array.from({ length: 35 }, (_, i) => `n${i}`);
  const rel = `wiki/${segs.join('/')}/leaf.md`;
  const result = await uploadVault(request, OWNER, [{ rel, body: md('very deep') }]);
  expect(result.errors, 'over-deep is tolerated, not a crash').toEqual([]);
  await request.dispose();
}
