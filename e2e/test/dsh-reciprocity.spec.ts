// dsh-reciprocity.spec.ts — eiab North Star 2/3: our generic loader mounts a FOREIGN dsh-ecosystem
// block unchanged, the mirror of "our blocks load on dsh". A foreign block (the server-everything
// MCP, a koishi/cordis-lineage server) is pasted through the REAL install path (POST /blocks, the
// same path the adversary-isolation spec uses) — if the loading mechanism is truly the same cordis
// loader, it mounts into our runtime unchanged, its capability is usable, and it is sandboxed like
// any of our blocks (no dependency auto-wired, no elevated trust).
//
// Black-box: assert the observable — the foreign capability appears and runs, and the foreign block
// gets no more trust than ours — never how the loader mounts it. (Riding the dsh MARKETPLACE is a
// separate concern, covered by dsh-marketplace-install; the real npm connection by dsh-market-live.)

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
// A foreign dsh-ecosystem block: the server-everything MCP under a foreign id. Its tools surface
// sanitized as <id>_<tool>. Id is hyphen-free so it is not rewritten.
const FOREIGN = 'dshforeign';
const toolPrefix = `${FOREIGN}_`;

// foreignManifest — a plain sandbox_stdio block pointing at the demo server bind-mounted into the
// dev/e2e stack (/srv/plugins-demos/everything; never in a product image). It is an ordinary
// foreign MCP, mounted through the same loader as an owner's own paste.
function foreignManifest(): string {
  return [
    `id: ${FOREIGN}`,
    'title: DSH Foreign (reciprocity)',
    'version: "1"',
    'shape: visitor_only',
    'transport:',
    '  kind: sandbox_stdio',
    '  command: node',
    '  args: ["/plugin/node_modules/@modelcontextprotocol/server-everything/dist/index.js", "stdio"]',
    '  sandbox:',
    '    plugin_dir: /srv/plugins-demos/everything',
    '    allow_net: false',
  ].join('\n');
}

let admin: APIRequestContext;
let csrf = '';

test.beforeAll(async ({ playwright }) => {
  resetInstance();
  admin = await playwright.request.newContext();
  await claim(admin, findSetupToken(), OWNER);
  ({ csrf } = await login(admin, OWNER.email, OWNER.password));
  await mountForeign(admin, csrf);
});
test.afterAll(async () => { await admin?.dispose(); });

test.describe('eiab · reciprocity: our loader mounts a foreign dsh block unchanged', () => {
  test('a foreign dsh block mounts through our loader and appears in the panel', async () => {
    const cap = await findBlock(admin, csrf, FOREIGN);
    expect(cap, 'the foreign block is listed').toBeDefined();
  });

  test('the foreign block\'s capability is usable in a visitor session', async () => {
    const sess = await boundSession([FOREIGN], 'V');
    const tools = await sessionToolNames(admin, sess);
    expect(tools.some((t) => t.startsWith(toolPrefix)), 'the loaders interop — its tool is exposed')
      .toBe(true);
  });

  test('a foreign dsh block is sandboxed like ours — no elevated access on mount', async () => {
    const cap = await findBlock(admin, csrf, FOREIGN);
    expect(cap?.dependency, 'no supplier handle auto-wired to a foreign block').toBeFalsy();
  });
});

// ─── helpers ───

async function mountForeign(request: APIRequestContext, csrf: string): Promise<void> {
  // eslint-disable-next-line e2e-local/no-direct-mutating-api -- action under test: mount a foreign dsh block via our real loader, the reciprocity this spec drives
  const res = await request.post(`${BACKEND}/api/admin/blocks`, {
    headers: { 'X-Csrftoken': csrf }, data: { manifest: foreignManifest() },
  });
  if (res.status() !== 201 && res.status() !== 200) {
    throw new Error(`mount foreign block: ${res.status()}`);
  }
}

// boundSession — grant the foreign block (by id, on a role's skill — the ACL grant lives on the
// role, as acl-block-matrix grants a block) and open a visitor session.
async function boundSession(grantBlocks: string[], name: string): Promise<string> {
  const { code } = await issueCodeWithSkills(admin, csrf,
    { label: 'reciprocity', granted_skills: grantBlocks });
  const s = await issueSession(admin, { handle: OWNER.handle, mode: 'code', code, visitor_name: name });
  return s.session_token;
}
