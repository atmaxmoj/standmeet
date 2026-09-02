// sync-h-reconcile.spec.ts — H. idempotency + reconcile (target-state red, sync
// state machine).
// Default decisions: rename = orphan (③) · cross-genre move = update genre in place
// (④) · a partial upload never deletes (⑤; a whole-vault sync does prune, see
// sync-authoritative-prune).
// Key tolerances: partial-never-delete · vault-is-the-source · whole-batch resolution
// (forward-ref) · importing twice yields the same state.

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
  // F-L-61 — the guard is written and the red is proven ("the raw entry that wasn't
  // included in the upload must not be relocated" → Received false), but it is
  // **deliberately not wired into the suite yet**: the first-draft fix (a partial
  // upload always claims by source_path) immediately broke `moveDeeperReparent` and
  // `crossGenreMove` in this same file — those two cases encode "a move inside a
  // partial upload should update in place", which is **behavior in active use**, not
  // a gap. See the ④ section of F-L-61 in the findings.
  // Wiring a permanent red into CI only teaches the next person to ignore red, so
  // this stays here until the real fix lands (disambiguate duplicates by **corpus**).
  test('partial: nor MOVES them to another genre (F-L-61)', partialDoesNotRelocateOthers);
  test('partial: nor moves a same-named FOLDER node (F-L-61b)', partialDoesNotRelocateFolders);
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
// adminUpdateWiki — edit the body in place from the web side (**keeps the title** =
// the identity derived from the filename; changing the title would make it a
// different note).
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

// F-L-61 — **a partial upload must not touch notes it did not include.**
//
// What actually happened in prod: a subset upload of two files was sent (without
// authoritative), and `deleted: 0` — the "must not delete" half held — but `raw
// 482→479 · wiki 575→578`, meaning **three raw notes that weren't in the upload at
// all got relocated into wiki**.
//
// Mechanism: `dupTitles` is computed from **this upload** (`sync.go:86`), and
// `claimExisting` only claims by source_path for titles that are in dupTitles;
// everything else falls back to `GetByTitle` — **across genres**. In real corpus
// data, a title that duplicates across genres appears only once in a two-file
// upload, so it gets claimed by title against the row in the other genre, and
// updated in place to this upload's genre.
//
// Why this matters more than "it got deleted": genre is the boundary that gates
// visitor ACL, and raw is private material. **A single partial feed through the API
// can relocate private material onto the published side.**
async function partialDoesNotRelocateOthers({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  // Load the whole set first: the same title exists once in each of two genres
  // (real vaults are full of these).
  //
  // **The raw entry must be older**: claiming goes through `GetNoteByTitleAnyGenre`,
  // `ORDER BY created_at ASC LIMIT 1` — whichever one is oldest is always the one
  // displaced. When both are created in the same batch, wiki happens to come first,
  // so the defect doesn't trigger; in prod it triggered because those three raw
  // entries were older than the wiki entries sharing their name. Splitting this into
  // two uploads pins down the age ordering, so the red lands on the mechanism rather
  // than on table-insertion order.
  await uploadVault(request, OWNER, [{ rel: 'raw/shared-name.md', body: md('the raw one') }]);
  await uploadVault(request, OWNER, [
    { rel: 'wiki/shared-name.md', body: md('the wiki one') },
    { rel: 'raw/shared-name.md', body: md('the raw one') },
  ]);
  // **Identify this raw entry by body, not by title**: a raw row carries no title at
  // all (`corpus_rows.go`'s `rawItem` only sends body/preview — a raw card edits its
  // body in place, and its title is not its identity). The first draft here wrote
  // `title === 'shared-name'`, which made the precondition false **regardless of
  // whether this defect was present or not** — the red landed in the wrong place,
  // and I nearly concluded from that "the fix didn't work".
  const inRaw = async (): Promise<boolean> =>
    (await adminGenreList(request, OWNER, 'raw')).some((n) => (n.body ?? '').includes('the raw one'));
  expect(await inRaw(), 'the raw entry is present beforehand').toBe(true);

  // Feed only the wiki entry — the raw entry **is not part of this upload**, and not
  // a single byte of it should move.
  await uploadVault(request, OWNER, [{ rel: 'wiki/shared-name.md', body: md('edited wiki one') }]);

  expect(
    await inRaw(),
    'the raw entry was not part of this upload, so it must not be relocated — genre is the boundary of visitor ACL',
  ).toBe(true);
  // And this upload must land on **its own** wiki entry: the body changed, but the
  // row count did not grow.
  const wiki = (await adminGenreList(request, OWNER, 'wiki')).filter((n) => n.title === 'shared-name');
  expect(wiki.length, 'the wiki entry with this name is still exactly one row').toBe(1);
  await request.dispose();
}

// The second half of F-L-61 — **the "no file" kind of node, a folder**.
//
// After the fix above, prod replayed that same subset upload: both target notes
// landed correctly, `raw 482→481 · wiki 575→576` — and yet one thing was still
// relocated, and it was `math`: a **structural node** (a folder placeholder, with an
// empty `obsidian_source_path`). `claimExisting` always falls back to `GetByTitle`
// for a node with no file, because empty paths would all collide with each other —
// so "disambiguate by corpus" doesn't reach it at all: knowing that `math` is
// ambiguous doesn't help, because there is no second claiming rule for it.
//
// A structural node's identity is **(genre, title)**: it is simply a folder in its
// own tree. A same-named folder existing once per genre is the normal case in a real
// vault (`raw/math/` and `wiki/math/` coexisting).
async function partialDoesNotRelocateFolders({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  // Build the raw tree first (making it older), then give both genres a folder
  // named topic.
  await uploadVault(request, OWNER, [{ rel: 'raw/topic/note-r.md', body: md('raw child') }]);
  await uploadVault(request, OWNER, [
    { rel: 'raw/topic/note-r.md', body: md('raw child') },
    { rel: 'wiki/topic/note-w.md', body: md('wiki child') },
  ]);
  // The criterion is exactly what prod measured: the **row count** for genre raw.
  // It should be two (the folder topic + note-r); if the structural node gets
  // claimed into wiki, this would drop to one.
  //
  // This line is already red: a structural node has no source_path, so F-L-2's
  // "same name → claim by path" rule never reaches it at all — so a same-named
  // folder collapses even on a **whole-vault** upload, no partial upload required.
  const rawCount = async (): Promise<number> => (await adminGenreList(request, OWNER, 'raw')).length;
  expect(await rawCount(), 'with a topic folder in each genre, the raw tree is fully two rows').toBe(2);

  // Feed only the wiki entry — it brings along a structural node named topic, and
  // raw already has one too.
  await uploadVault(request, OWNER, [{ rel: 'wiki/topic/note-w.md', body: md('edited wiki child') }]);

  expect(await rawCount(), "raw's topic folder was not part of this upload, so it must not be relocated").toBe(2);
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
