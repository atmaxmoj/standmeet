// sync-c-title.spec.ts —— C. title = filename(目标态红)。
// filename(去 .md)就是 title;frontmatter 里的 title/slug/path 一律忽略(见 _templates 契约)。
// 空格文件名(normalize 前)→ 容忍连字符化;unicode 文件名 → 容忍。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import {
  claimSyncOwner, syncOwner, syncSession, syncRead, type SyncOwner,
} from '@/fixtures/vault-sync';

type Ctx = { playwright: Playwright };
const OWNER: SyncOwner = syncOwner('c');

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('sync C · title = filename', () => {
  test.beforeEach(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await claimSyncOwner(request, OWNER);
    await request.dispose();
  });

  // ── happy ──
  test('happy: ashby.md → title "ashby"', simpleFilename);
  test('happy: hyphenated good-regulator-theorem.md → title verbatim', hyphenatedFilename);
  // ── corner ──
  test('corner: folder-note foo/foo.md → title "foo"', folderNoteTitle);
  test('corner: frontmatter title present → ignored, filename wins', frontmatterTitleIgnored);
  // ── error / tolerance ──
  test('tolerance: a filename with spaces → hyphenated title', spacedFilename);
  test('tolerance: a unicode filename is accepted', unicodeFilename);
});

async function readTitle(
  request: APIRequestContext, path: string,
): Promise<string> {
  const sess = await syncSession(request, OWNER);
  return (await syncRead(request, sess, path)).title ?? '';
}

async function simpleFilename({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'wiki/ashby.md', body: makeVaultMD({ publish: true }, 'x') }]);
  expect(await readTitle(request, 'ashby')).toBe('ashby');
  await request.dispose();
}

async function hyphenatedFilename({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/good-regulator-theorem.md', body: makeVaultMD({ publish: true }, 'x') },
  ]);
  expect(await readTitle(request, 'good-regulator-theorem')).toBe('good-regulator-theorem');
  await request.dispose();
}

async function folderNoteTitle({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/optimization/optimization.md', body: makeVaultMD({ publish: true }, 'node') },
  ]);
  expect(await readTitle(request, 'optimization'), 'folder-note title = folder name').toBe('optimization');
  await request.dispose();
}

async function frontmatterTitleIgnored({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/order-theory.md', body: makeVaultMD({ publish: true, title: 'WRONG-FROM-FM' }, 'x') },
  ]);
  expect(await readTitle(request, 'order-theory'), 'filename wins over frontmatter title')
    .toBe('order-theory');
  await request.dispose();
}

async function spacedFilename({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/good regulator.md', body: makeVaultMD({ publish: true }, 'x') },
  ]);
  // tolerance: spaces → hyphens, so it is readable at the hyphenated path with a hyphenated title.
  expect(await readTitle(request, 'good-regulator'), 'spaced filename hyphenated').toBe('good-regulator');
  await request.dispose();
}

async function unicodeFilename({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const result = await uploadVault(request, OWNER, [
    { rel: 'wiki/控制论.md', body: makeVaultMD({ publish: true }, 'unicode') },
  ]);
  expect(result.errors, 'unicode filename accepted, no error').toEqual([]);
  await request.dispose();
}
