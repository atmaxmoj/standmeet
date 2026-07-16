// sync-authoritative-prune.spec.ts —— F-L-6: sync must MEAN sync.
//
// SyncVault was upsert-only ("绝不删没在这批里的"), so a note deleted from the vault lived in the
// corpus forever and re-syncing could never clean it — the corpus could only ever grow, and drifted
// away from the vault it is supposed to mirror. Sync has one meaning: make the destination equal the
// source.
//
// The delete semantics are MODE-dependent, which is why this spec is the mirror of
// sync-h-reconcile's `partialNeverDeletes` rather than a replacement for it:
//   * partial upload (no flag)      → absence means nothing → NEVER delete   (sync-h-reconcile)
//   * authoritative (whole vault)   → absence means deleted → prune          (here)
// Both must hold at once; getting either wrong is data loss or permanent ghosts.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { login as loginAPI } from '@/fixtures/admin';
import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import { BACKEND, claimSyncOwner, syncOwner, adminGenreList, type SyncOwner } from '@/fixtures/vault-sync';

type Ctx = { playwright: Playwright };
const OWNER: SyncOwner = syncOwner('prune');
const md = (body: string): string => makeVaultMD({ publish: true }, body);

// FULL_VAULT —— the whole vault: two roots and a folder with a child.
const FULL_VAULT = [
  { rel: 'wiki/keep.md', body: md('the note that stays') },
  { rel: 'wiki/gone.md', body: md('the note the owner deletes') },
  { rel: 'wiki/folder/folder.md', body: md('a folder note') },
  { rel: 'wiki/folder/child.md', body: md('a child inside the folder') },
];

async function titles(request: APIRequestContext): Promise<string[]> {
  const rows = await adminGenreList(request, OWNER, 'wiki');
  return rows.map((r) => r.title);
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('sync · authoritative prune (F-L-6: sync means sync)', () => {
  test.beforeEach(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await claimSyncOwner(request, OWNER);
    await request.dispose();
  });

  test('a note deleted from the vault is REMOVED on an authoritative re-sync', deletedNoteIsPruned);
  test('a whole deleted folder is removed, subtree and all', deletedFolderIsPruned);
  test('an unchanged authoritative re-sync deletes NOTHING', idempotentSyncDeletesNothing);
  test('a web-edited note absent from the vault is NOT pruned (web-wins)', webEditedSurvivesPrune);
  test('a PARTIAL upload still never deletes (the mirror guard)', partialStillNeverDeletes);
});

// deletedNoteIsPruned —— the core F-L-6 red: sync the vault, delete a note from the vault, re-sync
// authoritatively → the corpus must converge on the vault. RED pre-fix: 'gone' survives forever.
async function deletedNoteIsPruned({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, FULL_VAULT, { authoritative: true });
  expect(await titles(request)).toContain('gone');

  const minusGone = FULL_VAULT.filter((f) => f.rel !== 'wiki/gone.md');
  const res = await uploadVault(request, OWNER, minusGone, { authoritative: true });

  const after = await titles(request);
  expect(after, 'the note deleted from the vault must be gone from the corpus').not.toContain('gone');
  expect(after, 'the notes still in the vault must survive').toContain('keep');
  expect(res.deleted, 'the sync must report what it removed, not delete silently').toBe(1);
  await request.dispose();
}

// deletedFolderIsPruned —— deleting a whole folder from the vault removes the folder note AND its
// children (the FK cascade), not just the parent.
async function deletedFolderIsPruned({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, FULL_VAULT, { authoritative: true });
  expect(await titles(request)).toEqual(expect.arrayContaining(['folder', 'child']));

  const minusFolder = FULL_VAULT.filter((f) => !f.rel.startsWith('wiki/folder/'));
  await uploadVault(request, OWNER, minusFolder, { authoritative: true });

  const after = await titles(request);
  expect(after, 'the deleted folder note is gone').not.toContain('folder');
  expect(after, 'its children go with it — no orphaned subtree').not.toContain('child');
  expect(after, 'untouched notes survive').toContain('keep');
  await request.dispose();
}

// idempotentSyncDeletesNothing —— prune must key off ABSENCE, not off "was not written this run".
// An unchanged re-sync skips every note (nothing created/updated); if prune confused "skipped" with
// "absent" it would delete the entire corpus. This is the test that catches that inversion.
async function idempotentSyncDeletesNothing({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, FULL_VAULT, { authoritative: true });
  const before = (await titles(request)).sort();

  const res = await uploadVault(request, OWNER, FULL_VAULT, { authoritative: true });

  expect(res.deleted, 're-syncing an unchanged vault must delete nothing').toBe(0);
  expect((await titles(request)).sort(), 'state is identical').toEqual(before);
  await request.dispose();
}

// webEditedSurvivesPrune —— web-wins already protects an owner's web edit from being OVERWRITTEN;
// it must equally protect it from being DELETED. A note the owner edited on the web is no longer
// purely vault-owned, so its absence from the vault must not destroy that work.
async function webEditedSurvivesPrune({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, FULL_VAULT, { authoritative: true });
  const rows = await adminGenreList(request, OWNER, 'wiki');
  const gone = rows.find((r) => r.title === 'gone');
  expect(gone, 'fixture sanity: the note exists before the web edit').toBeTruthy();

  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await request.patch(`${BACKEND}/api/admin/corpus/wiki/${gone?.id}`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      title: 'gone', body: 'edited by the owner on the web', tags: [],
      parent_id: null, show_as_source: true,
    },
  });

  const minusGone = FULL_VAULT.filter((f) => f.rel !== 'wiki/gone.md');
  await uploadVault(request, OWNER, minusGone, { authoritative: true });

  expect(
    await titles(request),
    'a web-edited note must not be destroyed by its absence from the vault',
  ).toContain('gone');
  await request.dispose();
}

// partialStillNeverDeletes —— the mirror guard, asserted HERE too so the two opposite semantics are
// pinned side by side: the same subset upload that prunes when authoritative must delete nothing
// when it is only a partial feed.
async function partialStillNeverDeletes({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, FULL_VAULT, { authoritative: true });

  const res = await uploadVault(request, OWNER, [FULL_VAULT[0] as { rel: string; body: string }]);

  expect(res.deleted, 'a partial upload must never delete').toBe(0);
  expect(
    (await titles(request)).sort(),
    'every note absent from the partial upload survives',
  ).toEqual(['child', 'folder', 'gone', 'keep']);
  await request.dispose();
}
