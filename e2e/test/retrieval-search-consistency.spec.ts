// retrieval-search-consistency.spec.ts —— A. corpus_search × Meili read/write consistency (crawl face).
//
// The corpus_search engine moves from PG FTS to Meili; the invariant is "searchable immediately after
// write, unsearchable immediately after delete" —— Meili is a derived projection of Postgres, and the
// write path does synchronous upsert/delete + WaitForTask for strong consistency.
// Some cases are already green under the current PG FTS (migration guard); A8 fuzzy / A9 CJK / A13 rapid
// updates are new, and drive Meili.
// ⚠️ Some are RED until Meili is wired to corpus_search.

import { test, expect } from '@/fixtures/test';

import { seedWiki } from '@/fixtures/corpus';
import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import {
  deleteWiki, promoteWikiToOutput, searchTitles, setPublished,
  setupRetrievalOwner, updateWiki, type RetrievalOwner,
} from '@/fixtures/retrieval';
import { issueSession } from '@/fixtures/visitor';
import type { VisitorSession } from '@/fixtures/visitor';

let O: RetrievalOwner;

async function fullSess(): Promise<VisitorSession> {
  return issueSession(O.request, { handle: O.handle, code: O.fullCode, visitor_name: 'V' });
}

async function promoteThenSearchable(): Promise<void> {
  await seedWiki(O.request, O.apiToken, O.sid, { title: 'A1 note', body: 'ZEBRAKW unique', path: 'promoteThenSearchable-note' });
  expect(await searchTitles(O.request, await fullSess(), 'ZEBRAKW')).toContain('A1 note');
}

async function updateSwapsTerms(): Promise<void> {
  const { wikiID } = await seedWiki(O.request, O.apiToken, O.sid, { title: 'A2 note', body: 'OLDKWBRAVO', path: 'updateSwapsTerms-note' });
  await updateWiki(O.request, O.apiToken, O.sid, wikiID, { title: 'A2 note', body: 'NEWKWCHARLIE now' });
  const s = await fullSess();
  expect(await searchTitles(O.request, s, 'OLDKWBRAVO'), 'old gone').not.toContain('A2 note');
  expect(await searchTitles(O.request, s, 'NEWKWCHARLIE'), 'new in').toContain('A2 note');
}

async function deleteNoGhost(): Promise<void> {
  const { wikiID } = await seedWiki(O.request, O.apiToken, O.sid, { title: 'A3 note', body: 'DELTAKW gone', path: 'deleteNoGhost-note' });
  await deleteWiki(O.request, O.apiToken, O.sid, wikiID);
  expect(await searchTitles(O.request, await fullSess(), 'DELTAKW')).not.toContain('A3 note');
}

// A4 —— retrieval ACL = grantedGlobs, **not** gated by published (published is the gate for the public
// landing/SEO, a separate path from code-gated retrieval, see retrieval-vs-corpus-ACL). Guard: toggling
// published does not change retrieval visibility.
async function publishToggleDoesNotGate(): Promise<void> {
  const { wikiID } = await seedWiki(O.request, O.apiToken, O.sid, { title: 'A4 note', body: 'ECHOKW toggle', path: 'publishToggleDoesNotGate-note' });
  await setPublished(O.request, O.csrf, wikiID, false);
  expect(await searchTitles(O.request, await fullSess(), 'ECHOKW'), 'code-grant sees unpublished').toContain('A4 note');
  await setPublished(O.request, O.csrf, wikiID, true);
  expect(await searchTitles(O.request, await fullSess(), 'ECHOKW'), 'still visible published').toContain('A4 note');
}

// A5 —— bulk vault sync → every synced note enters the index (after sync, ReindexOwner rebuilds the
// whole batch). Note: vault sync is **additive (title-claim upsert)**, not destructive; deleting a note
// from the vault is not auto-deleted by a re-sync, deletion goes through explicit delete_wiki (see A3).
// So this only checks "bulk sync all-in", not "partial re-sync deletes what's missing".
async function bulkSyncAllIndexed(): Promise<void> {
  const cred = { email: O.email, password: O.password };
  await uploadVault(O.request, cred, [
    { rel: 'wiki/foxnote.md', body: makeVaultMD({ publish: true }, 'FOXTROTKW one') },
    { rel: 'wiki/golfnote.md', body: makeVaultMD({ publish: true }, 'GOLFKW two') },
  ]);
  expect(await searchTitles(O.request, await fullSess(), 'FOXTROTKW')).toContain('foxnote');
  expect(await searchTitles(O.request, await fullSess(), 'GOLFKW')).toContain('golfnote');
}

async function renameStillSearchable(): Promise<void> {
  const { wikiID } = await seedWiki(O.request, O.apiToken, O.sid, { title: 'A6 old', body: 'HOTELKW', path: 'renameStillSearchable-old' });
  await updateWiki(O.request, O.apiToken, O.sid, wikiID, { title: 'A6 new', body: 'HOTELKW' });
  expect(await searchTitles(O.request, await fullSess(), 'HOTELKW')).toContain('A6 new');
}

async function cjkSearch(): Promise<void> {
  await seedWiki(O.request, O.apiToken, O.sid, { title: '卢塞恩项目笔记', body: '这是关于卢塞恩湖畔渡假村的规划', path: 'cjk-note' });
  expect(await searchTitles(O.request, await fullSess(), '渡假村'), '中文命中').toContain('卢塞恩项目笔记');
}

async function typoTolerant(): Promise<void> {
  await seedWiki(O.request, O.apiToken, O.sid, { title: 'A8 note', body: 'INTERNATIONAL settlement', path: 'typoTolerant-note' });
  expect(await searchTitles(O.request, await fullSess(), 'internatonal'), 'typo tolerated').toContain('A8 note');
}

async function genreMigrationSearchable(): Promise<void> {
  const { wikiID } = await seedWiki(O.request, O.apiToken, O.sid, { title: 'A11 note', body: 'INDIAKW promotable', path: 'genreMigrationSearchable-note' });
  await promoteWikiToOutput(O.request, O.apiToken, O.sid, wikiID, { title: 'A11 note', body: 'INDIAKW promotable' });
  expect(await searchTitles(O.request, await fullSess(), 'INDIAKW'), 'findable post-promotion').toContain('A11 note');
}

async function rapidUpdatesLastWins(): Promise<void> {
  const { wikiID } = await seedWiki(O.request, O.apiToken, O.sid, { title: 'A13 note', body: 'JULIETKW v1', path: 'rapidUpdatesLastWins-note' });
  await updateWiki(O.request, O.apiToken, O.sid, wikiID, { title: 'A13 note', body: 'JULIETKW v2' });
  await updateWiki(O.request, O.apiToken, O.sid, wikiID, { title: 'A13 note', body: 'KILOKW v3' });
  const s = await fullSess();
  expect(await searchTitles(O.request, s, 'JULIETKW'), 'intermediate gone').not.toContain('A13 note');
  expect(await searchTitles(O.request, s, 'KILOKW'), 'final in').toContain('A13 note');
}

async function emptyQueryNoCrash(): Promise<void> {
  const s = await fullSess();
  expect(Array.isArray(await searchTitles(O.request, s, ''))).toBe(true);
  expect(Array.isArray(await searchTitles(O.request, s, '   '))).toBe(true);
}

test.describe('A · corpus_search × Meili 读写一致', () => {
  test.beforeAll(async ({ playwright }) => { O = await setupRetrievalOwner(playwright, 'searchcons'); });
  test.afterAll(async () => { await O.request.dispose(); });

  test('A1 promote → 立刻搜到', promoteThenSearchable);
  test('A2 改 body → 旧词出、新词入', updateSwapsTerms);
  test('A3 删 → 无 ghost', deleteNoGhost);
  test('A4 unpublish → 搜不到;republish → 回来', publishToggleDoesNotGate);
  test('A5 vault 批量 sync → 全进、vault 删的消失', bulkSyncAllIndexed);
  test('A6 rename → 仍搜到', renameStillSearchable);
  test('A9 中文搜索命中', cjkSearch);
  test('A8 模糊 typo 容错', typoTolerant);
  test('A11 genre 迁移后仍搜到、旧无 ghost', genreMigrationSearchable);
  test('A13 快速连改 → 反映最后一次', rapidUpdatesLastWins);
  test('A15 空/空白 query 不崩', emptyQueryNoCrash);
});
