// upgrade-installed-blocks-integrity.spec.ts —— old volume + new code: the deploy brings
// installed_blocks.origin / .integrity (`2026-10-11-installed-blocks-integrity.sql`, roadmap 7.2.a).
//
// "Done": the columns arrive; a block the owner pasted before the upgrade is kept and still
// mounts, as the owner's; a marketplace block installed after the upgrade survives a restart (it
// used to live in memory only and vanish on the next deploy).
//
// Method (as upgrade-job-seen): a pasted block on the new code, then the columns dropped and the
// migration forgotten, then exactly one action: restart the backend (= deploy).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login } from '@/fixtures/admin';
import { findBlock, installBlockManifest } from '@/fixtures/blocks';
import { execSQL, findSetupToken, querySQL, resetInstance, restartBackend } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';

const MIGRATION = '2026-10-11-installed-blocks-integrity.sql';
const PASTED = 'upgradepasted';
const MANIFEST = [
  `id: ${PASTED}`, 'title: Pasted before the upgrade', 'version: "1"', 'shape: visitor_only',
  'transport:', '  kind: sandbox_stdio', '  command: node',
  '  args: ["/plugin/node_modules/@modelcontextprotocol/server-everything/dist/index.js", "stdio"]',
  '  sandbox:', '    plugin_dir: /srv/plugins-demos/everything', '    allow_net: false',
].join('\n');
const OWNER = {
  email: 'upgradeblocks@example.com', password: 'correct-horse-battery-staple',
  handle: 'upgradeblocks', fullName: 'Upgrade Blocks',
};

let admin: APIRequestContext;
let csrf = '';
const count = (sql: string): number => Number(querySQL(sql));
const columns = (): number => count(`SELECT count(*) FROM information_schema.columns
  WHERE table_name='installed_blocks' AND column_name IN ('origin','integrity')`);

test.describe.configure({ mode: 'serial', timeout: 300_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  resetInstance();
  admin = await playwright.request.newContext();
  await claim(admin, findSetupToken(), OWNER);
  ({ csrf } = await login(admin, OWNER.email, OWNER.password));
});
test.afterAll(async () => {
  test.setTimeout(300_000);
  restartBackend();
  await admin?.dispose();
});

test('an old volume + a deploy → the columns arrive; the pasted block is kept as the owner\'s', async () => {
  expect(await installBlockManifest(admin, csrf, MANIFEST)).toBe(201);
  execSQL('ALTER TABLE installed_blocks DROP COLUMN IF EXISTS origin');
  execSQL('ALTER TABLE installed_blocks DROP COLUMN IF EXISTS integrity');
  execSQL(`DELETE FROM schema_migrations WHERE name = '${MIGRATION}'`);
  expect(columns(), 'pre-state built').toBe(0);

  restartBackend();

  expect(columns(), 'both columns arrived').toBe(2);
  expect(count(`SELECT count(*) FROM schema_migrations WHERE name = '${MIGRATION}'`)).toBe(1);
  ({ csrf } = await login(admin, OWNER.email, OWNER.password));
  const pasted = await findBlock(admin, csrf, PASTED);
  expect(pasted, 'the pasted block still mounts').toBeDefined();
  expect(pasted?.origin).toBe('owner');
});

test('…a marketplace block installed on the upgraded data survives the next deploy', async () => {
  const token = await createAPIToken(admin, csrf, 'upgrade-blocks');
  const sid = await initMCP(admin, token);
  await callTool(admin, token, sid, 'blocks.marketplace_install', { id: '@deepseek-ai/cordis-plugin-integrity' });
  restartBackend();
  ({ csrf } = await login(admin, OWNER.email, OWNER.password));
  const row = await findBlock(admin, csrf, 'dshintegritydemo');
  expect(row, 'still installed after the restart').toBeDefined();
  expect(row?.origin).toBe('marketplace');
});
