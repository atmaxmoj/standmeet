// resume-master-trash.spec.ts —— a deleted résumé master waits in the trash for 90 days.
//
// A master is an asset (the owner's own résumé, written once and reused), not configuration. Before,
// resume.master_delete was a hard DELETE: one wrong call from the owner's AI lost it for good.
// Now it leaves every list, waits in the trash, and comes back with its content; a daily job purges
// what is older than 90 days. The draft that was based on it stops naming it while it is in the
// trash (resume-master-delete.spec.ts) and names it again once it is restored.
//
// Black box: MCP for the owner's AI, the panel for the owner. The purge test winds a trash row's
// clock back (execSQL) — there is no "pretend a quarter passed" endpoint.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { execSQL, findSetupToken, resetInstance } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import {
  contentWith, masterCard, mcpMasterCreate, mcpMasterDelete, mcpMasterGet, mcpMasterList, openDrafts,
} from '@/fixtures/resume-masters';

const OWNER = {
  email: 'master-trash@example.com', password: 'correct-horse-battery-staple',
  handle: 'mastertrash', fullName: 'Master Trash Owner',
};
const TRASH_DAYS = 90;

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

interface TrashedMaster { id: string; name: string; deleted_at: string; purge_at: string }

let request: APIRequestContext;
let c: { request: APIRequestContext; token: string; sid: string };

const trash = async () =>
  (await callTool<{ items: TrashedMaster[] }>(c.request, c.token, c.sid, 'resume.master_trash', {})).items;
const restore = (id: string) =>
  callTool<{ ok: boolean }>(c.request, c.token, c.sid, 'resume.master_restore', { master_id: id });

test.describe('résumé masters · delete goes to the trash; restore brings the master back', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'master-trash');
    c = { request, token, sid: await initMCP(request, token) };
  });

  test.afterAll(async () => { await request.dispose(); });

  test('MCP: delete hides it, the trash lists it, restore returns it with its content', async () => {
    const m = await mcpMasterCreate(c, { name: 'Kept master', resume_content: contentWith('KEPTSUMMARY') });
    await mcpMasterDelete(c, m.id);

    expect((await mcpMasterList(c)).items.map((x) => x.id), 'gone from the list').not.toContain(m.id);
    await expect(mcpMasterGet(c, m.id), 'gone from get').rejects.toThrow(/not found/i);
    const items = await trash();
    expect(items.map((x) => x.name)).toEqual(['Kept master']);
    const kept = Date.parse(items[0]?.purge_at ?? '') - Date.parse(items[0]?.deleted_at ?? '');
    expect(Math.round(kept / 86_400_000), 'purge date = deleted + 90 days').toBe(TRASH_DAYS);

    await restore(m.id);
    const back = await mcpMasterGet(c, m.id);
    expect(back.name).toBe('Kept master');
    expect(JSON.stringify(back.resume_content)).toContain('KEPTSUMMARY');
    expect(await trash(), 'a restored master leaves the trash').toEqual([]);
    await expect(restore(m.id), 'restoring twice is refused').rejects.toThrow(/not in the trash/i);
  });

  test(`the purge job drops masters trashed more than ${TRASH_DAYS} days ago`, async () => {
    const old = await mcpMasterCreate(c, { name: 'Old master', resume_content: contentWith('OLD') });
    const fresh = await mcpMasterCreate(c, { name: 'Fresh master', resume_content: contentWith('FRESH') });
    await mcpMasterDelete(c, old.id);
    await mcpMasterDelete(c, fresh.id);
    execSQL(`UPDATE resume_masters SET deleted_at = now() - interval '${TRASH_DAYS + 1} days' WHERE id = '${old.id}'`);

    await callTool(c.request, c.token, c.sid, 'tasks.run_periodic', { name: 'resume master trash purge' });

    await expect.poll(async () => (await trash()).map((x) => x.name), { timeout: 30_000 }).toEqual(['Fresh master']);
    await expect(restore(old.id), 'a purged master is gone for good').rejects.toThrow(/not in the trash/i);
    await restore(fresh.id);
  });

  test('panel: deleting a master card → the trash lists it → restore → the card is back',
    async ({ adminPage: page }) => {
      await mcpMasterCreate(c, { name: 'Panel master', resume_content: contentWith('PANEL') });
      await openDrafts(page);
      await masterCard(page, 'Panel master').getByTestId('master-delete').click();
      await expect(page.getByTestId('master-delete-modal'), 'the confirm says where it goes')
        .toContainText(/trash for 90 days/i);
      await page.getByTestId('master-delete-confirm').click();
      await expect(masterCard(page, 'Panel master')).toHaveCount(0, { timeout: 10_000 });

      await gotoAdminSection(page, 'trash');
      const row = page.locator('[data-testid^="trash-master-row-"]').filter({ hasText: 'Panel master' });
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.locator('[data-testid^="trash-master-restore-"]').click();
      await expect(row, 'a restored master leaves the trash').toHaveCount(0, { timeout: 15_000 });

      await openDrafts(page);
      await expect(masterCard(page, 'Panel master'), 'the card is back').toHaveCount(1, { timeout: 15_000 });
    });
});
