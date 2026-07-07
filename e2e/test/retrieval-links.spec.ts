// retrieval-links.spec.ts —— B. corpus_links(1 跳,分 outgoing/backlinks)× 边一致(crawl face)。
//
// corpus_links{path} → {outgoing, backlinks}:顺 note_refs 出边 + 入边。边是 owner 写 [[Title]] 时
// RebuildNoteRefs 建的 → 加/删链接即时反映。只 1 跳。link 按 title 解析,target 先于 linker 存在。
// ⚠️ 全 RED until corpus_links op 实现。

import { test, expect } from '@/fixtures/test';

import { seedWiki } from '@/fixtures/corpus';
import {
  deleteWiki, links, setupRetrievalOwner, updateWiki, type RetrievalOwner,
} from '@/fixtures/retrieval';
import { issueSession } from '@/fixtures/visitor';
import type { VisitorSession } from '@/fixtures/visitor';

let O: RetrievalOwner;

function outTitles(body: { result?: { outgoing: { title: string }[] } }): string[] {
  return (body.result?.outgoing ?? []).map((h) => h.title);
}
function backTitles(body: { result?: { backlinks: { title: string }[] } }): string[] {
  return (body.result?.backlinks ?? []).map((h) => h.title);
}
async function sess(): Promise<VisitorSession> {
  return issueSession(O.request, { handle: O.handle, code: O.fullCode, visitor_name: 'V' });
}

async function outgoingBacklinkSymmetry(): Promise<void> {
  await seedWiki(O.request, O.apiToken, O.sid, { title: 'Bravo', body: 'target', path: 'bravo' });
  await seedWiki(O.request, O.apiToken, O.sid, { title: 'Alfa', body: 'see [[Bravo]]', path: 'alfa' });
  const s = await sess();
  expect(outTitles((await links(O.request, s, 'alfa')).body)).toContain('Bravo');
  expect(backTitles((await links(O.request, s, 'bravo')).body)).toContain('Alfa');
}

async function linkAddRemoveSyncs(): Promise<void> {
  await seedWiki(O.request, O.apiToken, O.sid, { title: 'Gamma', body: 't', path: 'gamma' });
  const { wikiID } = await seedWiki(O.request, O.apiToken, O.sid, { title: 'Src3', body: 'no links', path: 'src3' });
  const s = await sess();
  expect(outTitles((await links(O.request, s, 'src3')).body), 'initially none').not.toContain('Gamma');
  await updateWiki(O.request, O.apiToken, O.sid, wikiID, { title: 'Src3', body: 'now [[Gamma]]' });
  expect(outTitles((await links(O.request, s, 'src3')).body), 'added').toContain('Gamma');
  await updateWiki(O.request, O.apiToken, O.sid, wikiID, { title: 'Src3', body: 'removed' });
  expect(outTitles((await links(O.request, s, 'src3')).body), 'removed').not.toContain('Gamma');
}

async function deleteTargetNoDangling(): Promise<void> {
  const { wikiID: delID } = await seedWiki(O.request, O.apiToken, O.sid, { title: 'Deletable', body: 't', path: 'deletable' });
  await seedWiki(O.request, O.apiToken, O.sid, { title: 'Src4', body: 'ref [[Deletable]]', path: 'src4' });
  const s = await sess();
  expect(outTitles((await links(O.request, s, 'src4')).body)).toContain('Deletable');
  await deleteWiki(O.request, O.apiToken, O.sid, delID);
  expect(outTitles((await links(O.request, s, 'src4')).body), 'dangling gone').not.toContain('Deletable');
}

async function noLinksBothEmpty(): Promise<void> {
  await seedWiki(O.request, O.apiToken, O.sid, { title: 'Lonely', body: 'nothing', path: 'lonely' });
  const r = await links(O.request, await sess(), 'lonely');
  expect(r.body.result?.outgoing).toEqual([]);
  expect(r.body.result?.backlinks).toEqual([]);
}

async function oneHopOnly(): Promise<void> {
  await seedWiki(O.request, O.apiToken, O.sid, { title: 'HopC', body: 'leaf', path: 'hopc' });
  await seedWiki(O.request, O.apiToken, O.sid, { title: 'HopB', body: 'to [[HopC]]', path: 'hopb' });
  await seedWiki(O.request, O.apiToken, O.sid, { title: 'HopA', body: 'to [[HopB]]', path: 'hopa' });
  const a = outTitles((await links(O.request, await sess(), 'hopa')).body);
  expect(a, '1-hop').toContain('HopB');
  expect(a, '2-hop excluded').not.toContain('HopC');
}

async function selfLinkExcluded(): Promise<void> {
  await seedWiki(O.request, O.apiToken, O.sid, { title: 'Selfy', body: 'I am [[Selfy]]', path: 'selfy' });
  const r = await links(O.request, await sess(), 'selfy');
  expect(outTitles(r.body)).not.toContain('Selfy');
  expect(backTitles(r.body)).not.toContain('Selfy');
}

async function brokenLinkExcluded(): Promise<void> {
  await seedWiki(O.request, O.apiToken, O.sid, { title: 'Broken', body: 'to [[NoSuchNoteXYZ]]', path: 'broken' });
  expect(outTitles((await links(O.request, await sess(), 'broken')).body)).toEqual([]);
}

async function duplicateLinkDeduped(): Promise<void> {
  await seedWiki(O.request, O.apiToken, O.sid, { title: 'Dup', body: 't', path: 'dup' });
  await seedWiki(O.request, O.apiToken, O.sid, { title: 'Src9', body: '[[Dup]] and [[Dup]]', path: 'src9' });
  const out = outTitles((await links(O.request, await sess(), 'src9')).body).filter((t) => t === 'Dup');
  expect(out.length, 'deduped').toBe(1);
}

async function bidirectionalBothSides(): Promise<void> {
  const bib = await seedWiki(O.request, O.apiToken, O.sid, { title: 'BiB', body: 'seed', path: 'bib' });
  await seedWiki(O.request, O.apiToken, O.sid, { title: 'BiA', body: 'to [[BiB]]', path: 'bia' });
  await updateWiki(O.request, O.apiToken, O.sid, bib.wikiID, { title: 'BiB', body: 'back to [[BiA]]' });
  const a = await links(O.request, await sess(), 'bia');
  expect(outTitles(a.body), 'outgoing').toContain('BiB');
  expect(backTitles(a.body), 'backlink').toContain('BiB');
}

// B13 —— 不存在的 path:走 corpus_read 一样的 friendly not-found envelope(ok=true + result.error,
// 不是 500),且不泄漏任何邻居。
async function missingPathFriendly(): Promise<void> {
  const r = await links(O.request, await sess(), 'no/such/path');
  expect(r.status, 'not 500').toBeLessThan(500);
  expect(r.body.result?.outgoing ?? [], 'no neighbors on not-found').toEqual([]);
  expect(r.body.result?.backlinks ?? [], 'no neighbors on not-found').toEqual([]);
}

test.describe('B · corpus_links 边一致 + 1 跳', () => {
  test.beforeAll(async ({ playwright }) => { O = await setupRetrievalOwner(playwright, 'links'); });
  test.afterAll(async () => { await O.request.dispose(); });

  test('B1/B2 outgoing/backlinks 对称', outgoingBacklinkSymmetry);
  test('B3 加/删链接 → outgoing 同步', linkAddRemoveSyncs);
  test('B4 删 target → 无悬挂', deleteTargetNoDangling);
  test('B5 无链接 → 皆空不崩', noLinksBothEmpty);
  test('B6 只 1 跳', oneHopOnly);
  test('B7 self-link 排除', selfLinkExcluded);
  test('B8 broken link 不入', brokenLinkExcluded);
  test('B9 重复链接去重', duplicateLinkDeduped);
  test('B10 双向 → 同在 out 和 back', bidirectionalBothSides);
  test('B13 不存在 path → friendly not-found', missingPathFriendly);
});
