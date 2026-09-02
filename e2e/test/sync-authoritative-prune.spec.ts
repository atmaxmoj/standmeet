// sync-authoritative-prune.spec.ts —— F-L-6: sync must MEAN sync.
//
// SyncVault was upsert-only ("never delete anything not in this batch"), so a note deleted from the vault lived in the
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
import { listAdminWritings, makeVaultMD, uploadVault } from '@/fixtures/obsidian';
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
  test('a web-edited note deleted from the vault is STILL pruned (no web-wins)', webEditIsNotAPin);
  test('a PARTIAL upload still never deletes (the mirror guard)', partialStillNeverDeletes);
  test('an authoritative sync keeps the writings it just imported (F-L-63)', writingsSurviveTheirOwnImport);
});

// F-L-63 -- **a full-vault import deletes the very writing it just created.**
//
// Measured in prod: the real vault has `writings/the-business-model-wedge.md`, while
// the DB's row count for `genre='writing'` is **0**; importing the same vault twice in
// a row, the second receipt reads `1 new · 0 updated · 1 deleted · 1076 unchanged` --
// every import creates one row and deletes it right back, going in circles forever.
//
// Traced by reading the mechanism (not by guessing): `pruneAbsent`'s keep set comes
// from `st.idOf`, and `st.idOf` only holds nodes from **the corp tree** (wiki/
// subjectivity/raw). writings goes through a different path (`syncWritings` ->
// `ImportWritings`); it matches up fine but **never reports itself into keep**, so
// `PruneAbsentVaultNotes` sees a row that "was imported from the vault, and isn't in
// keep", and deletes it exactly as defined.
//
// The criterion has to be able to fail: after the first import, the writing must still
// be there, and **re-importing the same vault must be a no-op** -- that second half is
// exactly where check 4 ("a second import changes nothing") breaks down on real
// corpus data.
async function writingsSurviveTheirOwnImport({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const vault = [
    ...FULL_VAULT,
    {
      rel: 'writings/a-piece.md',
      body: makeVaultMD({ title: 'A Piece', slug: 'a-piece', publish: true }, 'the writing body'),
    },
  ];
  const first = await uploadVault(request, OWNER, vault, { authoritative: true });
  expect(first.deleted, '第一次导入不许删掉它自己刚建的东西').toBe(0);
  const after = await listAdminWritings(request, OWNER);
  expect(after.some((w) => w.slug === 'a-piece'), 'writing 落地了').toBe(true);

  const second = await uploadVault(request, OWNER, vault, { authoritative: true });
  expect(second.created, '同一份 vault 再导一次不新建').toBe(0);
  expect(second.deleted, '也不删 —— 第二次导入是空操作（check 4）').toBe(0);
  // F-L-64 -- **and it must not rewrite either.** The writings path used to have no
  // "did it actually change" comparison; it saved an existing row unconditionally
  // whenever it found one, so every import bumped `updated_at` on every writing, and
  // from then on "what was recently edited" could no longer be trusted.
  expect(second.updated, '内容一字未变就不该被重写（F-L-64）').toBe(0);
  await request.dispose();
}

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

// webEditIsNotAPin —— editing a note on the web does NOT pin it against its own vault. The vault is
// the single live source, so if the owner then deletes that note from the vault and syncs, it goes.
// There is no "who wins": to keep web work, export it back to the vault first, then sync.
async function webEditIsNotAPin({ playwright }: Ctx): Promise<void> {
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
  const res = await uploadVault(request, OWNER, minusGone, { authoritative: true });

  expect(
    await titles(request),
    'a web edit does not survive deletion from its own vault — sync means sync',
  ).not.toContain('gone');
  expect(res.deleted, 'the web-edited note is reported as removed').toBe(1);
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
