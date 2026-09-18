// dsh-marketplace-install.spec.ts — ride the dsh marketplace. An owner SEARCHES the marketplace
// (npm, dsh scope), INSTALLS a block by its package id, and it becomes a first-class block on the
// instance — installed by data, sandboxed like any block, removable. The full owner-facing
// lifecycle, not one happy call.
//
// Hermetic: BLOCK_MARKET_NPM_BASE_URL points at the in-cluster npm mock (mock-stack/job-board),
// which serves a dsh package (@deepseek-ai/cordis-plugin-demo) whose tarball carries a standmeet
// manifest (block id dshmarketdemo, reusing the server-everything demo) + the dsh.bundle.patch
// marker. The REAL npm connection is proven separately, opt-in, by dsh-market-live.
//
// Black-box: search behaviour, install success/failure/idempotency, the installed block's origin +
// usability, its confinement, and uninstall — never how the fetch/mount works internally.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { issueSession } from '@/fixtures/visitor';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { sessionToolNames, findBlock } from '@/fixtures/blocks';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'marketplace@example.com', password: 'correct-horse-battery-staple',
  handle: 'mktowner', fullName: 'Marketplace Owner',
};
// The mock's dsh package (install id = npm package name) and the block it mounts (from the
// tarball's standmeet.block.yaml). Its tools surface sanitized as <block-id>_<tool>.
const PKG = '@deepseek-ai/cordis-plugin-demo';
const BLOCK = 'dshmarketdemo';
const toolPrefix = `${BLOCK}_`;

let admin: APIRequestContext;
let csrf = '';

test.beforeAll(async ({ playwright }) => {
  resetInstance();
  admin = await playwright.request.newContext();
  await claim(admin, findSetupToken(), OWNER);
  ({ csrf } = await login(admin, OWNER.email, OWNER.password));
});
test.afterAll(async () => { await admin?.dispose(); });

test.describe('dsh marketplace · search', () => {
  test('search returns matching marketplace blocks, each with an install id + version', async () => {
    const hits = await search(admin, 'cordis');
    expect(hits.length, 'at least one match').toBeGreaterThan(0);
    expect(hits.some((h) => h.id === PKG), 'the dsh demo package is a hit').toBe(true);
    const demo = hits.find((h) => h.id === PKG)!;
    expect(demo.version, 'entry carries a version').toBeTruthy();
  });

  test('search for something absent returns an empty list, not an error', async () => {
    const hits = await search(admin, 'no-such-block-zzzq');
    expect(hits, 'absent query → empty, 200').toEqual([]);
  });

  test('the dsh-scope default (empty query) lists the ecosystem', async () => {
    const hits = await search(admin, '');
    expect(hits.some((h) => h.id === PKG), 'empty query lists the dsh scope').toBe(true);
  });
});

test.describe('dsh marketplace · install (success / failure / idempotency)', () => {
  test('install an unknown id → a clean 4xx-class error, nothing mounted', async () => {
    const status = await installStatus(admin, csrf, '@no/such-block-zzzq');
    expect(status, 'unknown id is a client error, not a 5xx').toBeGreaterThanOrEqual(400);
    expect(status, 'unknown id is a client error, not a 5xx').toBeLessThan(500);
    expect(await findBlock(admin, csrf, 'nosuchblockzzzq'), 'nothing mounted').toBeUndefined();
  });

  test('install a block → it appears in the blocks panel with origin=marketplace, enabled',
    async () => {
      await install(admin, csrf, PKG);
      const cap = await findBlock(admin, csrf, BLOCK);
      expect(cap, 'installed block is listed').toBeDefined();
      expect(cap?.origin, 'origin marks it as marketplace-sourced').toBe('marketplace');
      expect(cap?.enabled).toBe(true);
    });

  test('installing the same package twice is idempotent (no duplicate, no crash)', async () => {
    await install(admin, csrf, PKG);
    await install(admin, csrf, PKG);
    const rows = await listBlocks(admin, csrf);
    expect(rows.filter((b) => b.id === BLOCK).length, 'exactly one row for the block').toBe(1);
  });
});

test.describe('dsh marketplace · use / confine / remove', () => {
  test('an installed marketplace block’s capability is usable in a visitor session', async () => {
    await install(admin, csrf, PKG);
    const code = await issueCodeGranting(admin, csrf, 'MKT-USE', [BLOCK]);
    const sess = await issueSession(admin,
      { handle: OWNER.handle, mode: 'code', code, visitor_name: 'V' });
    const tools = await sessionToolNames(admin, sess.session_token);
    expect(tools.some((t) => t.startsWith(toolPrefix)), 'its tool is exposed').toBe(true);
  });

  // ── confinement: a marketplace block is NOT more trusted than any other block ──
  test('a marketplace block is sandboxed like any block — install grants it no elevated access',
    async () => {
      await install(admin, csrf, PKG);
      const cap = await findBlock(admin, csrf, BLOCK);
      expect(cap?.dependency, 'no dependency auto-wired to a marketplace block').toBeFalsy();
      expect(cap?.origin, 'still just a block, marketplace-sourced').toBe('marketplace');
    });

  // ── remove ──
  test('uninstall a marketplace block → its tool disappears from new sessions', async () => {
    await install(admin, csrf, PKG);
    const code = await issueCodeGranting(admin, csrf, 'MKT-RM', [BLOCK]);
    const before = await issueSession(admin,
      { handle: OWNER.handle, mode: 'code', code, visitor_name: 'B' });
    expect((await sessionToolNames(admin, before.session_token)).some((t) => t.startsWith(toolPrefix)))
      .toBe(true);

    await uninstall(admin, csrf, BLOCK);
    const after = await issueSession(admin,
      { handle: OWNER.handle, mode: 'code', code, visitor_name: 'A' });
    expect((await sessionToolNames(admin, after.session_token)).some((t) => t.startsWith(toolPrefix)),
      'gone after uninstall').toBe(false);
    expect(await findBlock(admin, csrf, BLOCK), 'no longer listed').toBeUndefined();
  });
});

// ─── helpers ───

interface MarketHit { id: string; version?: string; description?: string }
interface BlockRow { id: string; origin?: string; enabled?: boolean; dependency?: unknown }

async function search(request: APIRequestContext, q: string): Promise<MarketHit[]> {
  const qs = new URLSearchParams({ q }).toString();
  const res = await request.get(`${BACKEND}/api/admin/blocks/marketplace/search?${qs}`);
  if (res.status() !== 200) throw new Error(`marketplace search: ${res.status()}`);
  return (await res.json() as { results?: MarketHit[] }).results ?? [];
}

async function installStatus(
  request: APIRequestContext, csrf: string, id: string,
): Promise<number> {
  // eslint-disable-next-line e2e-local/no-direct-mutating-api -- action under test: install from the marketplace, the capability this spec drives
  const res = await request.post(`${BACKEND}/api/admin/blocks/marketplace/install`, {
    headers: { 'X-Csrftoken': csrf }, data: { id },
  });
  return res.status();
}

async function install(request: APIRequestContext, csrf: string, id: string): Promise<void> {
  const status = await installStatus(request, csrf, id);
  if (status !== 201 && status !== 200) throw new Error(`marketplace install ${id}: ${status}`);
}

async function uninstall(request: APIRequestContext, csrf: string, id: string): Promise<void> {
  // eslint-disable-next-line e2e-local/no-direct-mutating-api -- action under test: uninstall a marketplace block, the lifecycle this spec drives
  const res = await request.post(`${BACKEND}/api/admin/blocks/${id}/uninstall`, {
    headers: { 'X-Csrftoken': csrf }, data: {},
  });
  if (res.status() !== 200) throw new Error(`uninstall ${id}: ${res.status()}`);
}

async function listBlocks(request: APIRequestContext, _csrf: string): Promise<BlockRow[]> {
  const res = await request.get(`${BACKEND}/api/admin/blocks`);
  if (res.status() !== 200) throw new Error(`list blocks: ${res.status()}`);
  return (await res.json() as { blocks?: BlockRow[] }).blocks ?? [];
}

// issueCodeGranting — grant the installed block(s) by id on a role's skill (the ACL grant lives
// on the role, as acl-block-matrix grants a block); the block then exposes its tools.
async function issueCodeGranting(
  request: APIRequestContext, csrf: string, label: string, grantBlocks: string[],
): Promise<string> {
  const { code } = await issueCodeWithSkills(request, csrf, { label, granted_skills: grantBlocks });
  return code;
}
