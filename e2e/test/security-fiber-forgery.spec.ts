// security-fiber-forgery.spec.ts —— a block cannot write into another fiber's storage by naming
// that fiber in its request (docs/design/plugin/per-fiber-schema.md, checkpoint 1, T8).
//
// Each reach-back carries the native key the host minted into that sandbox; the key resolves to
// the fiber it was minted for, and that fiber — not anything the request says — picks the schema.
// Before checkpoint 1 the store took `fiber_id` from the request body, so a block could name any
// fiber and the host would create and fill that fiber's schema.
//
// The adversary fixture block, mounted here WITH the blockstore.insert host op, writes one marked
// document while naming the fiber b_victimfiber. Black-box on the outcome: the victim fiber's
// schema never appears, and the document sits in the caller's own fiber (a no-bundle visitor's
// root fiber).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { installBlockManifest, runToolAndRead } from '@/fixtures/blocks';
import { rootSchema } from '@/fixtures/bundles';
import { findSetupToken, querySQL, resetInstance } from '@/fixtures/instance';
import { issueSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'fiber-forgery@example.com', password: 'correct-horse-battery-staple',
  handle: 'fiberforgery', fullName: 'Fiber Forgery Owner',
};
const BLOCK = 'adversary-fiber';

const MANIFEST = [
  `id: ${BLOCK}`,
  'title: Adversary (fiber forgery)',
  'version: "1"',
  'shape: visitor_only',
  'raw_tool_names: true',
  'visitor_tools:',
  '  - adversary_forge_fiber_id',
  'transport:',
  '  kind: sandbox_stdio',
  '  command: node',
  '  args: ["/plugin/adversary-mcp.js"]',
  '  sandbox:',
  '    plugin_dir: /srv/plugins-demos/adversary',
  '    allow_net: false',
  '    host_ops:',
  '      - blockstore.insert',
].join('\n');

test.describe('security · a block cannot write into a fiber it names', () => {
  let admin: APIRequestContext;
  let token = '';

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    admin = await playwright.request.newContext();
    await claim(admin, findSetupToken(), OWNER);
    const { csrf } = await login(admin, OWNER.email, OWNER.password);
    expect(await installBlockManifest(admin, csrf, MANIFEST)).toBe(201);
    const { code } = await issueCodeWithSkills(admin, csrf, { granted_skills: [BLOCK] });
    token = (await issueSession(admin, {
      handle: OWNER.handle, mode: 'code', code, visitor_name: 'V',
    })).session_token;
  });
  test.afterAll(async () => { await admin?.dispose(); });

  test('the write lands in the caller\'s own fiber, never the one it named', async () => {
    const out = await runToolAndRead(admin, token, 'adversary_forge_fiber_id', {});
    expect(out, 'the host accepted the write').toMatchObject({ written: true });

    const victim = 'mcp_b_victimfiber_adversary_fiber';
    expect(querySQL(`SELECT count(*) FROM information_schema.schemata WHERE schema_name = '${victim}'`),
      'the named fiber\'s schema was never created').toBe('0');

    const own = rootSchema(querySQL(`SELECT id FROM owners WHERE handle = '${OWNER.handle}'`), BLOCK);
    expect(querySQL(`SELECT count(*) FROM ${own}.records WHERE doc->>'marker' = 'forged-fiber'`),
      'the document is filed under the caller\'s own fiber').toBe('1');
  });
});
