// upgrade-asset-trash.spec.ts —— an old volume + new code: the deploy carries the asset trash
// (`2026-10-08-asset-trash.sql`: assets.deleted_at).
//
// Method (mirrors upgrade-resume-masters): on a DB with pool files, roll back to the pre-upgrade
// shape — drop the column and its index, delete this migration's ledger row — then restart the
// backend (= deploy). The migration must arrive through the real mechanism.
//
// What the upgrade must keep: every file, still served. What it must add: a pre-upgrade file
// deleted now waits in the trash and restores.
//
// Serial: the DB is briefly in the old shape mid-run. Do not parallelize.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { execSQL, findSetupToken, querySQL, resetInstance, restartBackend } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { MEDIA } from '@/fixtures/genre-assets';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const MIGRATION = '2026-10-08-asset-trash.sql';
const OWNER = {
  email: 'asset-trash-upgrader@example.com', password: 'correct-horse-battery-staple',
  handle: 'assettrashupg', fullName: 'Asset Trash Upgrader',
};

function count(sql: string): number {
  return Number(querySQL(sql));
}

let request: APIRequestContext;
let token = '';
let assetID = '';

test.describe('upgrade · deploying the new version adds the asset trash', () => {
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    token = await createAPIToken(request, csrf, 'asset-trash-upgrade');
    const sid = await initMCP(request, token);
    assetID = (await callTool<{ asset_id: string }>(request, token, sid, 'assets.pool_upload',
      { url: MEDIA.pixel, filename: 'pre-upgrade.png' })).asset_id;
  });

  test.afterAll(async () => {
    restartBackend();
    await request.dispose();
  });

  test('an old volume with pool files + a deploy → the column is added, every file intact', () => {
    execSQL('DROP INDEX IF EXISTS assets_trash_idx');
    execSQL('ALTER TABLE assets DROP COLUMN IF EXISTS deleted_at');
    execSQL(`DELETE FROM schema_migrations WHERE name = '${MIGRATION}'`);
    expect(count(`SELECT count(*) FROM information_schema.columns
                  WHERE table_name='assets' AND column_name='deleted_at'`),
      'pre-state not built: the column is still there').toBe(0);

    restartBackend();

    expect(count(`SELECT count(*) FROM information_schema.columns
                  WHERE table_name='assets' AND column_name='deleted_at'`)).toBe(1);
    expect(count(`SELECT count(*) FROM schema_migrations WHERE name = '${MIGRATION}'`)).toBe(1);
    expect(count('SELECT count(*) FROM assets'), 'every file survives').toBe(1);
    expect(count('SELECT count(*) FROM assets WHERE deleted_at IS NOT NULL'), 'nothing trashed').toBe(0);
  });

  test('…the pre-upgrade file is served, goes to the trash on delete, and restores', async () => {
    const sid = await initMCP(request, token);
    const list = async () => (await callTool<{ items: { asset_id: string; url: string }[] }>(
      request, token, sid, 'assets.list', {})).items;
    const url = (await list()).find((a) => a.asset_id === assetID)?.url ?? '';
    expect((await request.get(new URL(url, BACKEND).toString())).status()).toBe(200);

    await callTool(request, token, sid, 'assets.pool_delete', { asset_id: assetID });
    const trash = await callTool<{ items: { asset_id: string }[] }>(request, token, sid, 'assets.trash', {});
    expect(trash.items.map((a) => a.asset_id)).toEqual([assetID]);
    await callTool(request, token, sid, 'assets.restore', { asset_id: assetID });
    expect((await list()).map((a) => a.asset_id)).toContain(assetID);
  });
});
