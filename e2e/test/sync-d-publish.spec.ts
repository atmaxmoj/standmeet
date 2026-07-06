// sync-d-publish.spec.ts —— D. publish 闸(目标态红)。
// leaf: publish:true 入、false/缺 跳(见 _templates:false → importer skips)。
// folder-note(结构节点)= 决策①默认:**无视 publish 照建为树节点**(否则已发布的子节点没父、路径断);
// 但它自己的 corpus_read 仍受 published 闸。非布尔 publish → 强转容忍。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import {
  claimSyncOwner, syncOwner, syncSession, syncRead, type SyncOwner,
} from '@/fixtures/vault-sync';

type Ctx = { playwright: Playwright };
const OWNER: SyncOwner = syncOwner('d');

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('sync D · publish gate', () => {
  test.beforeEach(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await claimSyncOwner(request, OWNER);
    await request.dispose();
  });

  // ── happy ──
  test('happy: publish:true leaf is imported', publishTrue);
  test('happy: publish:false leaf is skipped', publishFalse);
  // ── corner ──
  test('corner: no publish key → default skip', noPublishKey);
  test('corner: an unpublished folder-note still exists as a tree node for its published child', structuralFolderNote);
  // ── error / tolerance ──
  test('tolerance: publish:"true" (string) is coerced to true', publishStringTrue);
  test('tolerance: publish written in body (not frontmatter) is not honored', publishInBody);
});

async function readOf(request: APIRequestContext, path: string) {
  const sess = await syncSession(request, OWNER);
  return syncRead(request, sess, path);
}

async function publishTrue({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'wiki/kept.md', body: makeVaultMD({ publish: true }, 'k') }]);
  expect((await readOf(request, 'kept')).genre).toBe('wiki');
  await request.dispose();
}

async function publishFalse({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'wiki/draft.md', body: makeVaultMD({ publish: false }, 'd') }]);
  expect((await readOf(request, 'draft')).error ?? '').toMatch(/not found|access denied/i);
  await request.dispose();
}

async function noPublishKey({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'wiki/keyless.md', body: makeVaultMD({ tags: ['x'] }, 'k') }]);
  expect((await readOf(request, 'keyless')).error ?? '', 'no publish key → skip').toMatch(/not found|access denied/i);
  await request.dispose();
}

async function structuralFolderNote({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  // folder-note math is publish:false; its child kepler is publish:true → kepler must still resolve.
  await uploadVault(request, OWNER, [
    { rel: 'wiki/math/math.md', body: makeVaultMD({ publish: false, tags: ['node'] }, 'node index') },
    { rel: 'wiki/math/kepler.md', body: makeVaultMD({ publish: true }, 'kepler') },
  ]);
  expect((await readOf(request, 'math/kepler')).body ?? '', 'published child under unpublished node')
    .toContain('kepler');
  await request.dispose();
}

async function publishStringTrue({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/coerced.md', body: makeVaultMD({ publish: 'true' }, 'c') },
  ]);
  expect((await readOf(request, 'coerced')).genre, 'string "true" coerced').toBe('wiki');
  await request.dispose();
}

async function publishInBody({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/bodypub.md', body: makeVaultMD({ tags: ['x'] }, 'publish: true\nfake') },
  ]);
  expect((await readOf(request, 'bodypub')).error ?? '', 'body publish not honored')
    .toMatch(/not found|access denied/i);
  await request.dispose();
}
