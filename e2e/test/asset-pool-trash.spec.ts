// asset-pool-trash.spec.ts —— a file deleted from the asset pool waits in the trash for 90 days.
//
// An uploaded file is an owner asset (owner, 2026-10-08: assets soft-delete, configuration does
// not). Before, assets.pool_delete dropped the blob and the row at once. Now the file leaves the
// pool and stops being served, waits in the trash, and comes back byte-for-byte; a daily job
// purges what is older than 90 days, blob included. The reference guard is unchanged: a file
// something still uses cannot be deleted at all (global-assets-guard.spec.ts).
//
// Black box: MCP for the owner's AI, the served URL for what a reader sees, the panel for the
// owner. The purge test winds a trash row's clock back (execSQL).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { execSQL, findSetupToken, resetInstance } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { MEDIA } from '@/fixtures/genre-assets';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'asset-trash@example.com', password: 'correct-horse-battery-staple',
  handle: 'assettrash', fullName: 'Asset Trash Owner',
};
const TRASH_DAYS = 90;

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

interface PoolAsset { asset_id: string; url: string; original_filename: string }
interface TrashedAsset { asset_id: string; original_filename: string; deleted_at: string; purge_at: string }

let request: APIRequestContext;
let token = '';
let sid = '';

const tool = <T>(name: string, args: Record<string, unknown>) => callTool<T>(request, token, sid, name, args);
const upload = (filename: string) => tool<PoolAsset>('assets.pool_upload', { url: MEDIA.pixel, filename });
const pool = async () => (await tool<{ items: PoolAsset[] }>('assets.list', {})).items;
const trash = async () => (await tool<{ items: TrashedAsset[] }>('assets.trash', {})).items;
const status = async (url: string) => (await request.get(new URL(url, BACKEND).toString())).status();

test.describe('asset pool · delete goes to the trash; restore serves the file again', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    token = await createAPIToken(request, csrf, 'asset-trash');
    sid = await initMCP(request, token);
  });

  test.afterAll(async () => { await request.dispose(); });

  test('MCP: delete hides and stops serving it; restore lists and serves it again', async () => {
    const a = await upload('kept.png');
    const url = (await pool()).find((x) => x.asset_id === a.asset_id)?.url ?? '';
    expect(await status(url), 'served before the delete').toBe(200);

    await tool('assets.pool_delete', { asset_id: a.asset_id });
    expect((await pool()).map((x) => x.asset_id), 'gone from the pool').not.toContain(a.asset_id);
    expect(await status(url), 'not served from the trash').toBe(404);
    const items = await trash();
    expect(items.map((x) => x.original_filename)).toEqual(['kept.png']);
    const kept = Date.parse(items[0]?.purge_at ?? '') - Date.parse(items[0]?.deleted_at ?? '');
    expect(Math.round(kept / 86_400_000), 'purge date = deleted + 90 days').toBe(TRASH_DAYS);

    await tool('assets.restore', { asset_id: a.asset_id });
    const back = (await pool()).find((x) => x.asset_id === a.asset_id);
    expect(back, 'back in the pool').toBeDefined();
    expect(await status(back?.url ?? ''), 'served again — the blob was kept').toBe(200);
    expect(await trash()).toEqual([]);
    await expect(tool('assets.restore', { asset_id: a.asset_id }), 'restoring twice is refused')
      .rejects.toThrow(/not in the trash/i);
  });

  test(`the purge job drops files trashed more than ${TRASH_DAYS} days ago, blob and row`, async () => {
    const old = await upload('old.png');
    const fresh = await upload('fresh.png');
    await tool('assets.pool_delete', { asset_id: old.asset_id });
    await tool('assets.pool_delete', { asset_id: fresh.asset_id });
    execSQL(`UPDATE assets SET deleted_at = now() - interval '${TRASH_DAYS + 1} days'
             WHERE id = '${old.asset_id}'`);

    await tool('tasks.run_periodic', { name: 'asset trash purge' });

    await expect.poll(async () => (await trash()).map((x) => x.original_filename), { timeout: 30_000 })
      .toEqual(['fresh.png']);
    await expect(tool('assets.restore', { asset_id: old.asset_id }), 'a purged file is gone for good')
      .rejects.toThrow(/not in the trash/i);
    await tool('assets.restore', { asset_id: fresh.asset_id });
  });

  test('panel: delete a pool file → the trash lists it → restore → it is back in the pool',
    async ({ adminPage: page }) => {
      const a = await upload('panel.png');
      await gotoAdminSection(page, 'assets');
      await page.getByTestId(`asset-delete-${a.asset_id}`).click();
      await expect(page.getByTestId(`asset-delete-${a.asset_id}`)).toHaveCount(0, { timeout: 15_000 });

      await gotoAdminSection(page, 'trash');
      const row = page.getByTestId(`trash-asset-row-${a.asset_id}`);
      await expect(row).toContainText('panel.png', { timeout: 15_000 });
      await page.getByTestId(`trash-asset-restore-${a.asset_id}`).click();
      await expect(row).toHaveCount(0, { timeout: 15_000 });

      await gotoAdminSection(page, 'assets');
      await expect(page.getByTestId(`asset-delete-${a.asset_id}`), 'back in the pool')
        .toBeVisible({ timeout: 15_000 });
    });
});
