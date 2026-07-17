// sync-a-routing.spec.ts —— A. folder → genre 路由(目标态红)。
// 顶层 folder 决定 genre:wiki/→wiki · subjectivity/→subjectivity · raw/→raw inbox。
// output 无 folder(promote-derived)。未知顶层 / 根裸文件 / 空 vault → 优雅跳过不崩(容错)。

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import {
  claimSyncOwner, syncOwner, syncSession, syncRead, adminGenreList, type SyncOwner,
} from '@/fixtures/vault-sync';

type Ctx = { playwright: Playwright };
const OWNER: SyncOwner = syncOwner('a');

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('sync A · folder → genre routing', () => {
  test.beforeEach(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await claimSyncOwner(request, OWNER);
    await request.dispose();
  });

  // ── happy ──
  test('happy: wiki/ → genre wiki', wikiToGenre);
  test('happy: subjectivity/ → genre subjectivity', subjToGenre);
  test('happy: raw/ → raw inbox (not a corpus note genre)', rawToInbox);
  test('happy: deep-nested wiki/a/b/c.md still routes to genre wiki', deepStillWiki);
  // ── corner ──
  test('corner: an empty genre folder imports nothing, no crash', emptyGenreFolder);
  // ── error / tolerance ──
  test('error: a bare .md at vault root (no genre folder) is skipped', rootBareFileSkipped);
  test('error: an unknown top folder (journal/) is skipped, not mis-routed', unknownTopFolderSkipped);
  test('a vault whose only note is publish:false → it still lands (F-L-8)', unpublishedStillLands);
});

async function wikiToGenre({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/ashby.md', body: makeVaultMD({ publish: true }, 'variety') },
  ]);
  const sess = await syncSession(request, OWNER);
  expect((await syncRead(request, sess, 'ashby')).genre).toBe('wiki');
  await request.dispose();
}

async function subjToGenre({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'subjectivity/how-i-decide.md', body: makeVaultMD({ publish: true }, 'reversibility') },
  ]);
  const sess = await syncSession(request, OWNER);
  expect((await syncRead(request, sess, 'how-i-decide')).genre).toBe('subjectivity');
  await request.dispose();
}

async function rawToInbox({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'raw/scratch.md', body: makeVaultMD({ tags: ['seed'] }, 'RAWINBOXKW rough thought') },
  ]);
  const bodies = (await adminGenreList(request, OWNER, 'raw')).map((n) => n.body ?? '');
  expect(bodies.some((b) => b.includes('RAWINBOXKW')), 'raw/ → raw inbox').toBe(true);
  await request.dispose();
}

async function deepStillWiki({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/software/software.md', body: makeVaultMD({ publish: true }, 'sw node') },
    { rel: 'wiki/software/project/project.md', body: makeVaultMD({ publish: true }, 'proj node') },
    { rel: 'wiki/software/project/lucerna.md', body: makeVaultMD({ publish: true }, 'lucerna leaf') },
  ]);
  const sess = await syncSession(request, OWNER);
  expect((await syncRead(request, sess, 'software/project/lucerna')).genre, 'deep still wiki').toBe('wiki');
  await request.dispose();
}

async function emptyGenreFolder({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  // Only a subjectivity note; the wiki genre gets nothing → its list is empty, no crash.
  await uploadVault(request, OWNER, [
    { rel: 'subjectivity/solo.md', body: makeVaultMD({ publish: true }, 'solo') },
  ]);
  expect((await adminGenreList(request, OWNER, 'wiki')).length, 'no wiki notes → empty, no crash').toBe(0);
  await request.dispose();
}

async function rootBareFileSkipped({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/real.md', body: makeVaultMD({ publish: true }, 'real') },
    { rel: 'loose.md', body: makeVaultMD({ publish: true }, 'no genre folder') },
  ]);
  const sess = await syncSession(request, OWNER);
  expect((await syncRead(request, sess, 'real')).genre, 'real imported').toBe('wiki');
  expect((await syncRead(request, sess, 'loose')).error ?? '', 'root bare file skipped')
    .toMatch(/not found|access denied/i);
  await request.dispose();
}

async function unknownTopFolderSkipped({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'journal/2026-01-01.md', body: makeVaultMD({ publish: true }, 'private journal') },
  ]);
  const sess = await syncSession(request, OWNER);
  expect((await syncRead(request, sess, '2026-01-01')).error ?? '', 'unknown top folder skipped')
    .toMatch(/not found|access denied/i);
  expect((await syncRead(request, sess, 'journal/2026-01-01')).error ?? '', 'not mis-routed either')
    .toMatch(/not found|access denied/i);
  await request.dispose();
}

// emptyVault —— 名不副实的历史遗留：这个 vault **不是空的**，它有一篇 publish:false 的笔记。
//
// 这条曾经断言 `created: 0`，守的是「publish:false 不入库」—— 那个语义已经被 **F-L-8 明确推翻**
// （见 sync-d-publish.spec.ts 的头注释）：`publish` 是**可见性**闸，不是入库闸。vault 里路由进来的
// .md 一律落库，published=false 只意味着「要 code 才能看」。旧语义的代价是真实的：223 篇 wiki 里
// 没有一篇写了 `publish:`，于是 173 篇叶子永远进不了 corpus。
//
// 所以 created **必须**是 1。两条 spec 曾经直接互相矛盾，而矛盾的那一条还绿着 —— 它测的是一个
// 已经不存在的产品。这里改成守新语义里真正要紧的那件事：入库了，且没有崩。
async function unpublishedStillLands({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const result = await uploadVault(request, OWNER, [
    { rel: 'wiki/only-draft.md', body: makeVaultMD({ publish: false }, 'draft') },
  ]);
  expect(result.created, 'publish is a VISIBILITY gate, not an intake gate (F-L-8)').toBe(1);
  expect(result.errors, 'no errors').toEqual([]);
  await request.dispose();
}
