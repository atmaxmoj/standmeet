// upgrade-resume-master-trash.spec.ts —— an old volume + new code: the deploy carries the résumé
// master trash (`2026-10-08-resume-master-trash.sql`: resume_masters.deleted_at, and the one-default
// index limited to live masters).
//
// Method (mirrors upgrade-resume-masters): on a DB with masters, roll back to the real pre-upgrade
// shape — drop the column, put the old index back, delete this migration's ledger row — then
// restart the backend (= deploy). The migration must arrive through the real mechanism.
//
// What the upgrade must keep: every master, and which one is the default. What it must add: a
// pre-upgrade master deleted now waits in the trash and restores.
//
// Serial: the DB is briefly in the old shape mid-run. Do not parallelize.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { execSQL, findSetupToken, querySQL, resetInstance, restartBackend } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { contentWith, mcpMasterCreate, mcpMasterDelete, mcpMasterGet } from '@/fixtures/resume-masters';

const MIGRATION = '2026-10-08-resume-master-trash.sql';

const OWNER = {
  email: 'master-trash-upgrader@example.com', password: 'correct-horse-battery-staple',
  handle: 'mastertrashupg', fullName: 'Master Trash Upgrader',
};

function count(sql: string): number {
  return Number(querySQL(sql));
}

let request: APIRequestContext;
let token = '';
let general = '';
let java = '';

test.describe('upgrade · deploying the new version adds the résumé master trash', () => {
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    token = await createAPIToken(request, csrf, 'master-trash-upgrade');
    const c = { request, token, sid: await initMCP(request, token) };
    general = (await mcpMasterCreate(c, { name: 'General', resume_content: contentWith('G'), is_default: true })).id;
    java = (await mcpMasterCreate(c, { name: 'Java', resume_content: contentWith('J') })).id;
  });

  test.afterAll(async () => {
    restartBackend();
    await request.dispose();
  });

  test('an old volume with masters + a deploy → the column is added, masters and default intact', () => {
    execSQL('DROP INDEX IF EXISTS resume_masters_one_default');
    execSQL('DROP INDEX IF EXISTS resume_masters_trash_idx');
    execSQL('ALTER TABLE resume_masters DROP COLUMN IF EXISTS deleted_at');
    execSQL('CREATE UNIQUE INDEX resume_masters_one_default ON resume_masters(owner_id) WHERE is_default');
    execSQL(`DELETE FROM schema_migrations WHERE name = '${MIGRATION}'`);
    expect(count(`SELECT count(*) FROM information_schema.columns
                  WHERE table_name='resume_masters' AND column_name='deleted_at'`),
      'pre-state not built: the column is still there').toBe(0);

    restartBackend();

    expect(count(`SELECT count(*) FROM information_schema.columns
                  WHERE table_name='resume_masters' AND column_name='deleted_at'`)).toBe(1);
    expect(count(`SELECT count(*) FROM schema_migrations WHERE name = '${MIGRATION}'`)).toBe(1);
    expect(count('SELECT count(*) FROM resume_masters'), 'every master survives').toBe(2);
    expect(count('SELECT count(*) FROM resume_masters WHERE deleted_at IS NOT NULL'),
      'the upgrade trashes nothing').toBe(0);
    expect(querySQL('SELECT name FROM resume_masters WHERE is_default'), 'the default survives').toBe('General');
  });

  test('…a pre-upgrade master deleted now goes to the trash and restores', async () => {
    const c = { request, token, sid: await initMCP(request, token) };
    await mcpMasterDelete(c, java);
    const trash = await callTool<{ items: { id: string }[] }>(request, token, c.sid, 'resume.master_trash', {});
    expect(trash.items.map((x) => x.id)).toEqual([java]);
    await callTool(request, token, c.sid, 'resume.master_restore', { master_id: java });
    expect((await mcpMasterGet(c, java)).name).toBe('Java');
    expect((await mcpMasterGet(c, general)).is_default).toBe(true);
  });
});
