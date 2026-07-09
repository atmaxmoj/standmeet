// sync-k-raw-tree.spec.ts —— K. raw hierarchy (#151, target-state RED).
// raw is a flat inbox today; #151 gives raw the SAME node-tree as note (sync-b): nested raw/ folders
// → parent_id + a derived path, folder-note collapse (raw/foo/foo.md = node foo), missing-folder
// tolerance. MAIN acceptance: Obsidian can SYNC nested raw/ into that hierarchy — no crash, body lands,
// the admin raw row carries the tree path (mirrors wikiListItem.path). Model: sync-b-tree, for genre raw.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import {
  claimSyncOwner, syncOwner, adminGenreList, type SyncOwner, type AdminNote,
} from '@/fixtures/vault-sync';

type Ctx = { playwright: Playwright };
const OWNER: SyncOwner = syncOwner('k');
// raw: fm-exempt + not publish-gated, so a bare body is a valid raw file.
const md = (body: string): string => makeVaultMD({}, body);

// rawPathOf —— find the raw row carrying a unique body marker, return its derived tree path.
function rawPathOf(rows: AdminNote[], marker: string): string | null | undefined {
  return rows.find((r) => (r.body ?? '').includes(marker))?.path;
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('sync K · raw hierarchy (nested raw/ → tree, same idiom as note)', () => {
  test.beforeEach(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await claimSyncOwner(request, OWNER);
    await request.dispose();
  });

  test('main: Obsidian syncs nested raw/a/b/c.md into a tree (no crash, tree paths)', mainNestedTree);
  test('folder-note raw/foo/foo.md becomes node foo (path foo)', folderNoteIsNode);
  test('corner: root-level raw/note.md → path note, no parent', rootLevelLeaf);
  test('tolerance: missing intermediate folder-notes still yield a nested path', missingFolderNotes);
  test('idempotent: re-uploading nested raw updates in place, keeps the tree', resyncKeepsTree);
});

async function mainNestedTree({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const result = await uploadVault(request, OWNER, [
    { rel: 'raw/a/a.md', body: md('RAWK a-node') },
    { rel: 'raw/a/b/b.md', body: md('RAWK b-node') },
    { rel: 'raw/a/b/c.md', body: md('RAWK c-leaf') },
  ]);
  expect(result.errors, 'nested raw sync does not crash').toEqual([]);
  const rows = await adminGenreList(request, OWNER, 'raw');
  expect(rawPathOf(rows, 'RAWK a-node'), 'folder-note a → node a').toBe('a');
  expect(rawPathOf(rows, 'RAWK b-node'), 'folder-note a/b → node a/b').toBe('a/b');
  expect(rawPathOf(rows, 'RAWK c-leaf'), 'leaf under a/b → a/b/c').toBe('a/b/c');
  await request.dispose();
}

async function folderNoteIsNode({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'raw/foo/foo.md', body: md('RAWK foldernote') }]);
  const rows = await adminGenreList(request, OWNER, 'raw');
  expect(rawPathOf(rows, 'RAWK foldernote'), 'folder-note foo/foo.md → node foo').toBe('foo');
  await request.dispose();
}

async function rootLevelLeaf({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'raw/note.md', body: md('RAWK flatroot') }]);
  const rows = await adminGenreList(request, OWNER, 'raw');
  expect(rawPathOf(rows, 'RAWK flatroot'), 'root-level raw → path note').toBe('note');
  await request.dispose();
}

async function missingFolderNotes({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  // neither x/ nor y/ has a folder-note — tolerated, auto-nested (mirrors sync-b missingTwoLevels).
  await uploadVault(request, OWNER, [{ rel: 'raw/x/y/z.md', body: md('RAWK zleaf') }]);
  const rows = await adminGenreList(request, OWNER, 'raw');
  expect(rawPathOf(rows, 'RAWK zleaf'), 'missing folder-notes tolerated → x/y/z').toBe('x/y/z');
  await request.dispose();
}

async function resyncKeepsTree({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'raw/g/h.md', body: md('RAWKIDEM v1') }]);
  await uploadVault(request, OWNER, [{ rel: 'raw/g/h.md', body: md('RAWKIDEM v2') }]);
  const rows = await adminGenreList(request, OWNER, 'raw');
  const matched = rows.filter((r) => (r.body ?? '').includes('RAWKIDEM'));
  expect(matched.length, 'same path → single row (upsert, not append)').toBe(1);
  expect(matched[0]?.body, 'body updated to v2').toContain('v2');
  expect(matched[0]?.path, 'still nested under g → g/h').toBe('g/h');
  await request.dispose();
}
