// query-render.spec.ts —— native corpus queries (target-state RED). A ` ```standmeet-query `
// block inside a note body gets **server-side parsed** at read/render time into a live list
// (via the existing ACL-scoped CorpusLister), like Dataview but running on the real DB.
// Assertion surface: the body returned by visitor corpus_read — the query block should be
// replaced with a list of matching entries (currently RED: the raw block is left in place).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import {
  claimSyncOwner, syncOwner, syncSession, syncRead, type SyncOwner,
} from '@/fixtures/vault-sync';

type Ctx = { playwright: Playwright };
const OWNER: SyncOwner = syncOwner('qr');

// queryBlock — builds a standmeet-query fenced block (YAML-ish DSL).
function queryBlock(dsl: string): string {
  return '```standmeet-query\n' + dsl + '\n```';
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('native corpus query · render', () => {
  test.beforeEach(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await claimSyncOwner(request, OWNER);
    await request.dispose();
  });

  test('happy: genre + tag query renders a live list of matching notes', tagQuery);
  test('happy: children-of query lists a node’s children', childrenQuery);
  test('happy: sort + limit are honored', sortLimit);
  test('corner: an empty result renders an empty list, no crash', emptyResult);
  test('corner: two query blocks in one note both resolve independently', twoBlocks);
  test('seo: the resolved list is in the server-rendered body (indexable), not a client widget', seoServerRendered);
});

async function seedCybernetics(request: APIRequestContext): Promise<void> {
  await uploadVault(request, OWNER, [
    { rel: 'wiki/ashby.md', body: makeVaultMD({ publish: true, tags: ['cybernetics'] }, 'variety') },
    { rel: 'wiki/good-regulator.md', body: makeVaultMD({ publish: true, tags: ['cybernetics'] }, 'grt') },
    { rel: 'wiki/unrelated.md', body: makeVaultMD({ publish: true, tags: ['math'] }, 'off-topic') },
  ]);
}

async function bodyOf(request: APIRequestContext, path: string): Promise<string> {
  const sess = await syncSession(request, OWNER);
  return (await syncRead(request, sess, path)).body ?? '';
}

async function tagQuery({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await seedCybernetics(request);
  await uploadVault(request, OWNER, [{
    rel: 'wiki/cyb-index.md',
    body: makeVaultMD({ publish: true }, queryBlock('genre: wiki\ntag: cybernetics\nsort: title')),
  }]);
  const body = await bodyOf(request, 'cyb-index');
  expect(body, 'matching notes listed').toContain('ashby');
  expect(body, 'matching notes listed').toContain('good-regulator');
  expect(body, 'non-matching excluded').not.toContain('unrelated');
  expect(body, 'raw query DSL replaced').not.toContain('standmeet-query');
  await request.dispose();
}

async function childrenQuery({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/topic/topic.md', body: makeVaultMD({ publish: true }, 'the topic node') },
    { rel: 'wiki/topic/child-a.md', body: makeVaultMD({ publish: true }, 'a') },
    { rel: 'wiki/topic/child-b.md', body: makeVaultMD({ publish: true }, 'b') },
    { rel: 'wiki/idx.md', body: makeVaultMD({ publish: true }, queryBlock('children-of: topic')) },
  ]);
  const body = await bodyOf(request, 'idx');
  expect(body).toContain('child-a');
  expect(body).toContain('child-b');
  await request.dispose();
}

async function sortLimit({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/aaa.md', body: makeVaultMD({ publish: true, tags: ['x'] }, 'a') },
    { rel: 'wiki/bbb.md', body: makeVaultMD({ publish: true, tags: ['x'] }, 'b') },
    { rel: 'wiki/ccc.md', body: makeVaultMD({ publish: true, tags: ['x'] }, 'c') },
    { rel: 'wiki/lim.md', body: makeVaultMD({ publish: true }, queryBlock('tag: x\nsort: title\nlimit: 2')) },
  ]);
  const body = await bodyOf(request, 'lim');
  expect(body, 'limit 2 → first two by title').toContain('aaa');
  expect(body).toContain('bbb');
  expect(body, 'third excluded by limit').not.toContain('ccc');
  await request.dispose();
}

async function emptyResult({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/empty-idx.md', body: makeVaultMD({ publish: true }, queryBlock('tag: does-not-exist')) },
  ]);
  const body = await bodyOf(request, 'empty-idx');
  expect(body, 'empty result — block resolved to nothing, no crash').not.toContain('standmeet-query');
  await request.dispose();
}

async function twoBlocks({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await seedCybernetics(request);
  const body = queryBlock('tag: cybernetics') + '\n\n---\n\n' + queryBlock('tag: math');
  await uploadVault(request, OWNER, [{ rel: 'wiki/multi.md', body: makeVaultMD({ publish: true }, body) }]);
  const out = await bodyOf(request, 'multi');
  expect(out, 'first block resolved').toContain('ashby');
  expect(out, 'second block resolved').toContain('unrelated');
  await request.dispose();
}

async function seoServerRendered({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await seedCybernetics(request);
  await uploadVault(request, OWNER, [{
    rel: 'wiki/seo-idx.md', body: makeVaultMD({ publish: true }, queryBlock('tag: cybernetics')),
  }]);
  // the list is in the corpus body the server returns (so the reader server-renders it, SEO-indexed).
  const body = await bodyOf(request, 'seo-idx');
  expect(body, 'server-resolved, not a client-only widget').toContain('ashby');
  await request.dispose();
}
