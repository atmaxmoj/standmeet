// sync-f-frontmatter.spec.ts —— F. frontmatter 容错解析 + 映射(目标态红)。
// 畸形 YAML 不能崩(F1);tags 多写法(F2);字段映射/强转 + 老新名(F3);per-area schema、非白名单 key
// 忽略不整批失败(F4);body/frontmatter 分离(F5)。sync **宽容**(vault-side check 才是 gate)。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import {
  claimSyncOwner, syncOwner, syncSession, syncRead, adminGenreList, type SyncOwner,
} from '@/fixtures/vault-sync';

type Ctx = { playwright: Playwright };
const OWNER: SyncOwner = syncOwner('f');

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('sync F · frontmatter tolerance + mapping', () => {
  test.beforeEach(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await claimSyncOwner(request, OWNER);
    await request.dispose();
  });

  // ── F1 malformed YAML — must never crash the import ──
  test('tolerance: unclosed frontmatter (--- with no closing ---)', unclosedFrontmatter);
  test('tolerance: tab indentation in YAML (illegal) does not crash', tabIndent);
  test('tolerance: duplicate keys do not crash', duplicateKeys);
  test('tolerance: a --- in the body (horizontal rule) is not mistaken for fm close', hrInBody);
  test('tolerance: empty frontmatter (---\\n---) imports with defaults', emptyFrontmatter);
  test('tolerance: CRLF line endings parse', crlf);
  // ── F2 tags formats ──
  test('tags: list form parses', tagsList);
  test('tags: inline array [a, b] parses', tagsInlineArray);
  test('tags: comma string "a, b" parses', tagsCommaString);
  // ── F3 mapping + coercion ──
  test('map: seo_indexed:true (old name) → published', seoIndexedOld);
  test('map: an unknown/disallowed frontmatter key is ignored, note still imports', unknownKeyIgnored);
  test('map: aliases are dropped (not link targets)', aliasesDropped);
  // ── F4 per-area schema (lenient) ──
  test('area: raw/ is exempt from schema (any/no frontmatter ok)', rawExempt);
  test('area: a wiki leaf missing "publish" defaults to skip (not a hard error)', missingPublishSoft);
  // ── F5 body/frontmatter separation ──
  test('sep: body-only (no frontmatter) is tolerated', bodyOnly);
});

async function readOf(request: APIRequestContext, path: string) {
  const sess = await syncSession(request, OWNER);
  return syncRead(request, sess, path);
}
async function up(request: APIRequestContext, rel: string, body: string) {
  return uploadVault(request, OWNER, [{ rel, body }]);
}

// F1 ------------------------------------------------------------------
async function unclosedFrontmatter({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const r = await up(request, 'wiki/unclosed.md', '---\npublish: true\ntags: [x]\nbody with no close');
  expect(r.errors, 'unclosed fm tolerated').toEqual([]);
  await request.dispose();
}
async function tabIndent({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const r = await up(request, 'wiki/tabs.md', '---\npublish: true\ntags:\n\t- x\n---\nbody');
  expect(r.errors, 'tab indent tolerated').toEqual([]);
  await request.dispose();
}
async function duplicateKeys({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const r = await up(request, 'wiki/dup.md', '---\npublish: true\ntags: [a]\ntags: [b]\n---\nbody');
  expect(r.errors, 'dup keys tolerated').toEqual([]);
  await request.dispose();
}
async function hrInBody({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await up(request, 'wiki/hr.md', '---\npublish: true\n---\nabove\n\n---\n\nHRMARKER below the rule');
  expect((await readOf(request, 'hr')).body ?? '', 'hr in body preserved').toContain('HRMARKER');
  await request.dispose();
}
async function emptyFrontmatter({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const r = await up(request, 'wiki/emptyfm.md', '---\n---\njust body');
  expect(r.errors, 'empty fm tolerated').toEqual([]);
  await request.dispose();
}
async function crlf({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const r = await up(request, 'wiki/crlf.md', '---\r\npublish: true\r\n---\r\nbody\r\n');
  expect(r.errors, 'CRLF tolerated').toEqual([]);
  await request.dispose();
}

// F2 ------------------------------------------------------------------
async function tagsList({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await up(request, 'wiki/tl.md', '---\npublish: true\ntags:\n  - node\n  - x\n---\nbody');
  expect((await readOf(request, 'tl')).genre, 'list tags parsed').toBe('wiki');
  await request.dispose();
}
async function tagsInlineArray({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await up(request, 'wiki/ta.md', '---\npublish: true\ntags: [node, x]\n---\nbody');
  expect((await readOf(request, 'ta')).genre, 'inline array parsed').toBe('wiki');
  await request.dispose();
}
async function tagsCommaString({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await up(request, 'wiki/tc.md', '---\npublish: true\ntags: node, x\n---\nbody');
  expect((await readOf(request, 'tc')).genre, 'comma string parsed').toBe('wiki');
  await request.dispose();
}

// F3 ------------------------------------------------------------------
async function seoIndexedOld({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  // old field name seo_indexed:true maps to published.
  await up(request, 'wiki/seoidx.md', '---\nseo_indexed: true\ntags: [x]\n---\nbody');
  expect((await readOf(request, 'seoidx')).genre, 'seo_indexed → published').toBe('wiki');
  await request.dispose();
}
async function unknownKeyIgnored({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await up(request, 'wiki/unk.md',
    '---\npublish: true\nowns: [a]\naudience: engineers\nbogus_key: 42\n---\nbody');
  expect((await readOf(request, 'unk')).genre, 'unknown keys ignored, note imports').toBe('wiki');
  await request.dispose();
}
async function aliasesDropped({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await up(request, 'wiki/aliased.md', makeVaultMD({ publish: true, aliases: ['GRT', 'grt'] }, 'body'));
  expect((await readOf(request, 'aliased')).genre, 'aliases dropped, note fine').toBe('wiki');
  await request.dispose();
}

// F4 ------------------------------------------------------------------
async function rawExempt({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  // raw with weird/no frontmatter still syncs.
  const r = await up(request, 'raw/messy.md', 'no frontmatter at all, just RAWEXEMPTKW text');
  expect(r.errors, 'raw exempt from schema').toEqual([]);
  const bodies = (await adminGenreList(request, OWNER, 'raw')).map((n) => n.body ?? '');
  expect(bodies.some((b) => b.includes('RAWEXEMPTKW')), 'raw synced despite no fm').toBe(true);
  await request.dispose();
}
async function missingPublishSoft({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const r = await up(request, 'wiki/nopub.md', '---\ntags: [x]\n---\nbody');
  expect(r.errors, 'missing publish is a soft skip, not a hard error').toEqual([]);
  await request.dispose();
}

// F5 ------------------------------------------------------------------
async function bodyOnly({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const r = await up(request, 'wiki/bodyonly.md', 'just a body, no frontmatter block');
  expect(r.errors, 'body-only tolerated').toEqual([]);
  await request.dispose();
}
