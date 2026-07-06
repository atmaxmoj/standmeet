// sync-g-hidden.spec.ts —— G. hidden 文件**两层**处理(目标态红)。
// ① 噪音层 → 跳:`.git`/`.DS_Store`/`.trash`/`.claude`/`.scripts`/`_templates`/`.obsidian` 里的
//    workspace/app.json/`.md`;附件(非 .md)另作 media。
// ② 配置层 → **harvest(不跳)**:`.obsidian/snippets/*.css` + `appearance.json`(owner CSS)—— hidden
//    里的 Obsidian 配置是一等公民,采集而非丢弃(owner-css-edit 里详测,这里钉住"不跳")。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { makeVaultMD, uploadVault, PNG_1X1 } from '@/fixtures/obsidian';
import {
  claimSyncOwner, syncOwner, syncSession, syncRead, adminGenreList, type SyncOwner,
} from '@/fixtures/vault-sync';
import { adminGetCSS } from '@/fixtures/presentation';

type Ctx = { playwright: Playwright };
const OWNER: SyncOwner = syncOwner('g');
const md = (body: string): string => makeVaultMD({ publish: true }, body);

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('sync G · hidden files / non-notes skipped', () => {
  test.beforeEach(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await claimSyncOwner(request, OWNER);
    await request.dispose();
  });

  // ── happy ──
  test('happy: .obsidian / .git / .claude / .scripts dotdirs skipped', dotDirsSkipped);
  test('happy: _templates/ is skipped', templatesSkipped);
  // ── corner ──
  test('corner: a real note alongside hidden files still imports (only it counts)', realAlongsideHidden);
  test('corner: a dotfile INSIDE a genre folder is skipped', dotfileInGenre);
  // ── error / tolerance ──
  test('error: a .md inside a hidden dir (.obsidian/x.md) is still skipped', mdInHiddenDir);
  test('error: .trash/ is skipped', trashSkipped);
  test('tolerance: a non-.md attachment (png) does not become a note', attachmentNotNote);
  // ── harvest (config layer, NOT skipped) ──
  test('harvest: .obsidian/snippets/*.css + appearance.json ARE picked up (not skipped)', obsidianConfigHarvested);
});

async function obsidianConfigHarvested({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/note.md', body: md('a real note') },
    { rel: '.obsidian/snippets/theme.css', body: '.note { color: rgb(3, 3, 3) }' },
    { rel: '.obsidian/appearance.json', body: JSON.stringify({ enabledCssSnippets: ['theme'] }) },
  ]);
  // the note still imports (positive control), AND the .obsidian css is harvested (not skipped).
  expect((await adminGenreList(request, OWNER, 'wiki')).length, 'the real note imported').toBe(1);
  expect(await adminGetCSS(request, OWNER), '.obsidian/snippets css harvested, not skipped')
    .toContain('rgb(3, 3, 3)');
  await request.dispose();
}

async function readErr(request: APIRequestContext, path: string): Promise<string> {
  const sess = await syncSession(request, OWNER);
  return (await syncRead(request, sess, path)).error ?? '';
}

async function dotDirsSkipped({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/keep.md', body: md('keep') },
    { rel: '.obsidian/app.json', body: '{"x":1}' },
    { rel: '.git/config', body: '[core]' },
    { rel: '.claude/settings.json', body: '{}' },
    { rel: '.scripts/check.sh', body: '#!/bin/sh' },
  ]);
  const list = await adminGenreList(request, OWNER, 'wiki');
  expect(list.length, 'only the real note; dotdirs skipped').toBe(1);
  await request.dispose();
}

async function templatesSkipped({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/keep2.md', body: md('keep') },
    { rel: '_templates/note.md', body: md('template scaffold') },
  ]);
  expect(await readErr(request, 'note'), '_templates skipped').toMatch(/not found|access denied/i);
  await request.dispose();
}

async function realAlongsideHidden({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const r = await uploadVault(request, OWNER, [
    { rel: 'wiki/real.md', body: md('real') },
    { rel: '.obsidian/workspace.json', body: '{}' },
    { rel: '_templates/t.md', body: md('t') },
  ]);
  expect(r.created, 'only the one real note created').toBe(1);
  await request.dispose();
}

async function dotfileInGenre({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/note.md', body: md('note') },
    { rel: 'wiki/.DS_Store', body: 'junk' },
  ]);
  const list = await adminGenreList(request, OWNER, 'wiki');
  expect(list.length, 'dotfile in genre folder skipped').toBe(1);
  await request.dispose();
}

async function mdInHiddenDir({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/kept3.md', body: md('kept') },
    { rel: '.obsidian/snippets/note.md', body: md('should be ignored') },
  ]);
  expect(await readErr(request, 'note'), '.md inside hidden dir skipped').toMatch(/not found|access denied/i);
  await request.dispose();
}

async function trashSkipped({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/live.md', body: md('live') },
    { rel: '.trash/deleted.md', body: md('trashed') },
  ]);
  expect(await readErr(request, 'deleted'), '.trash skipped').toMatch(/not found|access denied/i);
  await request.dispose();
}

async function attachmentNotNote({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const r = await uploadVault(request, OWNER, [
    { rel: 'wiki/withimg.md', body: md('has an image') },
    { rel: 'wiki/diagram.png', body: PNG_1X1 },
  ]);
  // the png is an attachment, not a note: exactly one note created, no error.
  expect(r.created, 'attachment did not become a note').toBe(1);
  expect(r.errors).toEqual([]);
  await request.dispose();
}
