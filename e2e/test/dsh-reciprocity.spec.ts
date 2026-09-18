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
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { sessionToolNames, findBlock } from '@/fixtures/blocks';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'reciprocity@example.com', password: 'correct-horse-battery-staple',
  handle: 'recipowner', fullName: 'Reciprocity Owner',
};
// Foreign dsh-ecosystem fixtures: a single-block plugin and a dsh GROUP (a composition of
// plugins). Ids are hyphen-free — a discovered block's tools surface sanitized as
// <id>_<tool> (e.g. dshecho_echo), so a hyphen in the id would be rewritten.
const FOREIGN = { id: 'dshecho', tool: 'echo' };
const FOREIGN_GROUP = { id: 'dshdemogroup', members: ['dshecho', 'dshupper'], tool: 'echo' };
// toolName — how a discovered block's tool surfaces to a session: <id>_<tool> (not mcp__).
const toolName = (id: string, tool: string): string => `${id}_${tool}`;

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
    const tool = toolName(FOREIGN.id, FOREIGN.tool);
    const sess = await boundSession([FOREIGN.id], 'V');
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
    const tool = toolName(FOREIGN_GROUP.members[0]!, FOREIGN_GROUP.tool);
    const sess = await boundSession([FOREIGN_GROUP.members[0]!], 'G');
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

// boundSession — grant the foreign block(s) (by id, on a role's skill — the ACL grant
// lives on the role, as acl-block-matrix grants a block) and open a visitor session.
async function boundSession(grantBlocks: string[], name: string): Promise<string> {
  const { code } = await issueCodeWithSkills(admin, csrf,
    { label: 'reciprocity', granted_skills: grantBlocks });
  const s = await issueSession(admin, { handle: OWNER.handle, mode: 'code', code, visitor_name: name });
  return s.session_token;
}
