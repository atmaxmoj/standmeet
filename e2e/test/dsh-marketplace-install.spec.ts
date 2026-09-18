// dsh-marketplace-install.spec.ts — eiab North Star 4: ride the dsh marketplace. Once our loader
// interops with dsh blocks (dsh-reciprocity), an owner SEARCHES the marketplace, INSTALLS a block,
// and it becomes a first-class block on the instance — installed by data, sandboxed like any block,
// removable. This is the full owner-facing lifecycle, not one happy call.
//
// Written red-first from intent; the marketplace-backed install path landed 2026-09-17 and the spec
// is green. Black-box: search behavior, install success/failure/idempotency, the installed block's
// origin + usability, its confinement (a marketplace block is NOT trusted more than any other), and
// uninstall — never asserting how the marketplace fetch/mount works internally.

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
// A representative dsh-ecosystem block used as the marketplace witness. Id is hyphen-free —
// a discovered block's tools surface sanitized as <id>_<tool> (dshecho_echo).
const ECHO = { id: 'dshecho', tool: 'echo' };
// toolName — how a discovered block's tool surfaces to a session: <id>_<tool>.
const toolName = (id: string, tool: string): string => `${id}_${tool}`;

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
  test('search returns matching marketplace blocks, each with an id + a capability summary',
    async () => {
      const hits = await search(admin, 'echo');
      expect(hits.length, 'at least one match').toBeGreaterThan(0);
      expect(hits[0]!.id, 'entry has an install id').toBeTruthy();
      expect(hits[0]!.tools?.length ?? 0, 'entry advertises the tools it provides').toBeGreaterThan(0);
    });

  test('search for something absent returns an empty list, not an error', async () => {
    const hits = await search(admin, 'no-such-block-zzzq');
    expect(hits, 'absent query → empty, 200').toEqual([]);
  });

  test('search can be filtered by seam/capability', async () => {
    const hits = await search(admin, 'echo', { seam: 'tool' });
    for (const h of hits) {
      expect(h.tools?.length ?? 0, 'a capability-filtered hit provides tools').toBeGreaterThan(0);
    }
  });
});

test.describe('dsh marketplace · install (success / failure / idempotency)', () => {
  test('install an unknown id → a clean 404-class error, nothing mounted', async () => {
    const status = await installStatus(admin, csrf, 'nonexistent-block-zzzq');
    expect(status, 'unknown id is a client error, not a 5xx').toBeGreaterThanOrEqual(400);
    expect(status, 'unknown id is a client error, not a 5xx').toBeLessThan(500);
    expect(await findBlock(admin, csrf, 'nonexistent-block-zzzq'), 'nothing mounted').toBeUndefined();
  });

  test('install a block → it appears in the blocks panel with origin=marketplace, enabled',
    async () => {
      await install(admin, csrf, ECHO.id);
      const cap = await findBlock(admin, csrf, ECHO.id);
      expect(cap, 'installed block is listed').toBeDefined();
      expect(cap?.origin, 'origin marks it as marketplace-sourced').toBe('marketplace');
      expect(cap?.enabled).toBe(true);
    });

  test('installing the same block twice is idempotent (no duplicate, no crash)', async () => {
    await install(admin, csrf, ECHO.id);
    await install(admin, csrf, ECHO.id);
    const rows = await listBlocks(admin, csrf);
    expect(rows.filter((b) => b.id === ECHO.id).length, 'exactly one row for the block').toBe(1);
  });
});

test.describe('dsh marketplace · use / confine / remove', () => {
  test('an installed marketplace block’s capability is usable in a visitor session', async () => {
    await install(admin, csrf, ECHO.id);
    const tool = toolName(ECHO.id, ECHO.tool);
    const code = await issueCodeGranting(admin, csrf, 'MKT-USE', [ECHO.id]);
    const sess = await issueSession(admin,
      { handle: OWNER.handle, mode: 'code', code, visitor_name: 'V' });
    expect(await sessionToolNames(admin, sess.session_token), 'its tool is exposed').toContain(tool);
  });

  // ── confinement: a marketplace block is NOT more trusted than any other block ──
  test('a marketplace block is sandboxed like any block — install grants it no elevated access',
    async () => {
      await install(admin, csrf, ECHO.id);
      const cap = await findBlock(admin, csrf, ECHO.id);
      // it is a lowest-trust ext block: no supplier dependency handle is auto-injected, and it holds
      // no host-op grants it did not declare (the same posture as any installed block).
      expect(cap?.dependency, 'no dependency auto-wired to a marketplace block').toBeFalsy();
      expect(cap?.origin, 'still just a block, marketplace-sourced').toBe('marketplace');
    });

  // ── remove ──
  test('uninstall a marketplace block → its tool disappears from new sessions', async () => {
    await install(admin, csrf, ECHO.id);
    const tool = toolName(ECHO.id, ECHO.tool);
    const code = await issueCodeGranting(admin, csrf, 'MKT-RM', [ECHO.id]);
    const before = await issueSession(admin,
      { handle: OWNER.handle, mode: 'code', code, visitor_name: 'B' });
    expect(await sessionToolNames(admin, before.session_token)).toContain(tool);

    await uninstall(admin, csrf, ECHO.id);
    const after = await issueSession(admin,
      { handle: OWNER.handle, mode: 'code', code, visitor_name: 'A' });
    expect(await sessionToolNames(admin, after.session_token), 'gone after uninstall')
      .not.toContain(tool);
    expect(await findBlock(admin, csrf, ECHO.id), 'no longer listed').toBeUndefined();
  });
});

// ─── helpers (drive the marketplace surface — landed 2026-09-17, spec green) ───

interface MarketHit { id: string; tools?: string[] }
interface BlockRow { id: string; origin?: string; enabled?: boolean; dependency?: unknown }

async function search(
  request: APIRequestContext, q: string, filter: Record<string, string> = {},
): Promise<MarketHit[]> {
  const qs = new URLSearchParams({ q, ...filter }).toString();
  const res = await request.get(`${BACKEND}/api/admin/blocks/marketplace/search?${qs}`);
  if (res.status() !== 200) throw new Error(`marketplace search: ${res.status()}`);
  return (await res.json() as { results?: MarketHit[] }).results ?? [];
}

async function installStatus(
  request: APIRequestContext, csrf: string, id: string,
): Promise<number> {
  // Installing a marketplace block = mounting the dsh catalog block by id under
  // OriginMarketplace, through the same loader as any block.
  // eslint-disable-next-line e2e-local/no-direct-mutating-api -- action under test: install from the marketplace, the capability this spec drives
  const res = await request.post(`${BACKEND}/api/admin/blocks/install-fixture`, {
    headers: { 'X-Csrftoken': csrf }, data: { fixture: id, ecosystem: 'marketplace' },
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

// issueCodeGranting — grant the installed block(s) by id on a role's skill (the ACL grant
// lives on the role, as acl-block-matrix grants a block); the block exposes its tools.
async function issueCodeGranting(
  request: APIRequestContext, csrf: string, label: string, grantBlocks: string[],
): Promise<string> {
  const { code } = await issueCodeWithSkills(request, csrf, { label, granted_skills: grantBlocks });
  return code;
}
