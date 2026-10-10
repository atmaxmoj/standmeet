// upgrade-keypair-tools.spec.ts —— old volume + new code: the deploy brings the per-key tool list
// (`2026-10-10-keypair-tools.sql`: owner_keypairs.tools, roadmap 8.5.a).
//
// "Done": the column arrives empty on every existing key, and an empty list means what a key always
// meant — every tool its scopes cover. A key handed out before the upgrade keeps working.
//
// Method (as upgrade-application-outcomes): a key made on the new code, the column dropped and the
// migration ledger forgetting it (and every later migration naming the table), then exactly one
// action: restart the backend (= deploy).

import { test, expect } from '@/fixtures/test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { execSQL, querySQL, restartBackend } from '@/fixtures/instance';
import { initMCP, listTools } from '@/fixtures/mcp';
import { claimFreshOwner } from '@/fixtures/seed';

const MIGRATION = '2026-10-10-keypair-tools.sql';
const MIGRATIONS_DIR = path.resolve(__dirname, '../../backend/db/migrations');
const OWNER = { email: 'upgradekeys@example.com', password: 'correct-horse-battery-staple', handle: 'upgradekeys' };

const count = (sql: string): number => Number(querySQL(sql));

function laterMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql') && f >= MIGRATION)
    .filter((f) => f === MIGRATION || /\bowner_keypairs\b/.test(readFileSync(path.join(MIGRATIONS_DIR, f), 'utf-8')));
}

test.describe.configure({ mode: 'serial', timeout: 300_000 });

let key = '';

test.beforeAll(async ({ playwright }) => {
  await claimFreshOwner(playwright, OWNER);
});
test.afterAll(() => { restartBackend(); });

test('an old volume + a deploy → the tool list arrives empty; an old key still reaches every tool', async ({ request }) => {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  key = await createAPIToken(request, csrf, 'before-upgrade');
  execSQL('ALTER TABLE owner_keypairs DROP COLUMN IF EXISTS tools');
  execSQL(`DELETE FROM schema_migrations WHERE name IN (${laterMigrations().map((f) => `'${f}'`).join(',')})`);
  expect(count(`SELECT count(*) FROM information_schema.columns WHERE table_name='owner_keypairs' AND column_name='tools'`),
    'pre-state built').toBe(0);

  restartBackend();

  expect(count(`SELECT count(*) FROM information_schema.columns WHERE table_name='owner_keypairs' AND column_name='tools'`),
    'tools arrived').toBe(1);
  expect(count(`SELECT count(*) FROM owner_keypairs WHERE cardinality(tools) <> 0`), 'every key: no list').toBe(0);
  const names = (await listTools(request, key, await initMCP(request, key))).map((t) => t.name);
  expect(names, 'the old key still reaches a write tool').toContain('applications.commit');
  expect(names, 'and a read tool').toContain('jobs.history');
});
