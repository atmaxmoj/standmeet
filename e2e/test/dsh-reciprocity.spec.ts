// dsh-reciprocity.spec.ts — eiab North Star 2/3: our generic loader (internal/plugin/effect, the
// cordis-kernel port) loads a FOREIGN dsh-ecosystem block, the mirror of "our blocks load on dsh".
// If the loading mechanism is truly the same cordis loader, a dsh block should mount into our
// runtime unchanged, its capability be usable, it be sandboxed like any of our blocks, and a dsh
// GROUP compose through our loader too.
//
// RED-by-design until a foreign dsh block/group is vendored as a fixture and the reciprocal path is
// wired. Black-box, from intent: assert the observable — the foreign capability appears and runs,
// and the foreign block gets no more trust than ours — never how the loader mounts it.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { issueSession } from '@/fixtures/visitor';
import { sessionToolNames, findBlock } from '@/fixtures/blocks';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'reciprocity@example.com', password: 'correct-horse-battery-staple',
  handle: 'recipowner', fullName: 'Reciprocity Owner',
};
// Foreign dsh-ecosystem fixtures: a single-block plugin and a dsh GROUP (a composition of plugins).
const FOREIGN = { id: 'dsh-echo', tool: 'echo' };
const FOREIGN_GROUP = { id: 'dsh-demo-group', members: ['dsh-echo', 'dsh-upper'], tool: 'echo' };

let admin: APIRequestContext;
let csrf = '';

test.describe('eiab · reciprocity: our loader mounts foreign dsh blocks unchanged', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    admin = await playwright.request.newContext();
    await claim(admin, findSetupToken(), OWNER);
    ({ csrf } = await login(admin, OWNER.email, OWNER.password));
  });
  test.afterAll(async () => { await admin?.dispose(); });

  test('a dsh block mounts unchanged through our loader and appears with a foreign origin',
    async () => {
      await mountForeign(FOREIGN.id);
      const cap = await findBlock(admin, csrf, FOREIGN.id);
      expect(cap, 'the foreign block is listed').toBeDefined();
      expect(cap?.origin, 'marked as dsh-sourced, not builtin').toMatch(/dsh|foreign|marketplace/);
    });

  test('the foreign block\'s capability is usable in a visitor session', async () => {
    await mountForeign(FOREIGN.id);
    const tool = `mcp__${FOREIGN.id}__${FOREIGN.tool}`;
    const sess = await boundSession('RECIP-USE', [tool], 'V');
    expect(await sessionToolNames(admin, sess), 'the loaders interop — its tool is exposed')
      .toContain(tool);
  });

  test('a foreign dsh block is sandboxed like ours — no elevated access on mount', async () => {
    await mountForeign(FOREIGN.id);
    const cap = await findBlock(admin, csrf, FOREIGN.id);
    expect(cap?.dependency, 'no supplier handle auto-wired to a foreign block').toBeFalsy();
  });

  test('a dsh GROUP composes through our loader — every member\'s capability mounts', async () => {
    await mountForeignGroup(FOREIGN_GROUP.id);
    for (const m of FOREIGN_GROUP.members) {
      expect(await findBlock(admin, csrf, m), `group member ${m} mounted`).toBeDefined();
    }
    const tool = `mcp__${FOREIGN_GROUP.members[0]}__${FOREIGN_GROUP.tool}`;
    const sess = await boundSession('RECIP-GRP', [tool], 'G');
    expect(await sessionToolNames(admin, sess), 'a grouped member\'s tool is usable').toContain(tool);
  });
});

// ─── helpers (drive the reciprocal load path — RED until vendored + wired) ───

async function mountForeign(id: string): Promise<void> {
  // eslint-disable-next-line e2e-local/no-direct-mutating-api -- action under test: mount a foreign dsh block via our loader, the reciprocity this spec drives
  const res = await admin.post(`${BACKEND}/api/admin/blocks/install-fixture`, {
    headers: { 'X-Csrftoken': csrf }, data: { fixture: id, ecosystem: 'dsh' },
  });
  if (res.status() !== 201 && res.status() !== 200) throw new Error(`mount foreign ${id}: ${res.status()}`);
}

async function mountForeignGroup(id: string): Promise<void> {
  // eslint-disable-next-line e2e-local/no-direct-mutating-api -- action under test: mount a foreign dsh GROUP via our loader, the composition reciprocity this spec drives
  const res = await admin.post(`${BACKEND}/api/admin/blocks/install-fixture`, {
    headers: { 'X-Csrftoken': csrf }, data: { fixture: id, ecosystem: 'dsh', group: true },
  });
  if (res.status() !== 201 && res.status() !== 200) throw new Error(`mount foreign group ${id}: ${res.status()}`);
}

async function boundSession(code: string, tools: string[], name: string): Promise<string> {
  // eslint-disable-next-line e2e-local/no-direct-mutating-api -- action under test: grant the foreign block's tool to a visitor code this spec drives
  const res = await admin.post(`${BACKEND}/api/admin/codes`, {
    headers: { 'X-Csrftoken': csrf }, data: { code, label: 'reciprocity', granted_skills: tools },
  });
  if (res.status() !== 201) throw new Error(`issue code: ${res.status()}`);
  const s = await issueSession(admin, { handle: OWNER.handle, mode: 'code', code, visitor_name: name });
  return s.session_token;
}
