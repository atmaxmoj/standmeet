// microsite-trash.spec.ts —— a deleted microsite waits in the trash for 90 days.
//
// A microsite is an owner asset, not configuration (owner, 2026-10-08). Its delete was already soft
// (status='deleted'), but nothing could bring it back and nothing ever removed it — and the delete
// dropped the page's data store on the spot, so what visitors had left there was gone for good.
// Now: the trash lists it; restore brings back the same page, its live build and its store; a
// restore whose slug a newer page took is refused, naming the slug; a daily job purges pages
// deleted more than 90 days ago, with their builds.
//
// Black box: MCP for the owner's AI, the panel for the owner. The purge test winds a page's
// deletion clock back (execSQL) — there is no "pretend a quarter passed" endpoint.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { execSQL, findSetupToken, querySQL, resetInstance } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { publishPage } from '@/fixtures/microsite-rig';
import { listStoreDocs, setStoreWritable, writeStoreDoc } from '@/fixtures/microsite-store';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'microsite-trash@example.com', password: 'correct-horse-battery-staple',
  handle: 'micrositetrash', fullName: 'Microsite Trash Owner',
};
const TRASH_DAYS = 90;

const PAGE_APP = `
export default function App() {
  return <main><h1>KEPT_PAGE_CONTENT</h1></main>;
}
`.trim();

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

interface TrashedPage { id: string; slug: string; title: string; deleted_at: string; purge_at: string }

let request: APIRequestContext;
let csrf = '';
let token = '';
let sid = '';

const tool = <T>(name: string, args: Record<string, unknown>) => callTool<T>(request, token, sid, name, args);
const trash = async () => (await tool<{ items: TrashedPage[] }>('microsite.trash', {})).items;
const restore = (id: string) => tool('microsite.restore', { id });

test.describe('microsites · delete goes to the trash; restore brings the page back', () => {
  test.describe.configure({ mode: 'serial', timeout: 600_000 });

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    csrf = (await loginAPI(request, OWNER.email, OWNER.password)).csrf;
    token = await createAPIToken(request, csrf, 'microsite-trash');
    sid = await initMCP(request, token);
  });

  test.afterAll(async () => { await request.dispose(); });

  test('MCP: a deleted live page leaves /p, waits in the trash, and restores live with its store',
    async () => {
      await publishPage(request, csrf, 'keepme', PAGE_APP, 300_000);
      await setStoreWritable(request, csrf, 'keepme', true);
      await writeStoreDoc(request, 'keepme', 'notes', { text: 'VISITOR_NOTE' });

      await tool('microsite.delete', { slug: 'keepme' });
      expect((await request.get('/p/keepme')).status(), 'a deleted page is not served').toBe(404);
      const items = await trash();
      expect(items.map((p) => p.slug)).toEqual(['keepme']);
      const kept = Date.parse(items[0]?.purge_at ?? '') - Date.parse(items[0]?.deleted_at ?? '');
      expect(Math.round(kept / 86_400_000), 'purge date = deleted + 90 days').toBe(TRASH_DAYS);

      await restore(items[0]?.id ?? '');
      expect(await (await request.get('/p/keepme')).text(), 'the live build is served again')
        .toContain('KEPT_PAGE_CONTENT');
      const docs = await listStoreDocs(request, csrf, 'keepme');
      expect(JSON.stringify(docs), 'what visitors left in the store came back too').toContain('VISITOR_NOTE');
      expect(await trash(), 'a restored page leaves the trash').toEqual([]);
    });

  test('a restore whose slug a newer page took is refused, naming the slug', async () => {
    await tool('microsite.create', { slug: 'dup', title: 'first dup' });
    await tool('microsite.delete', { slug: 'dup' });
    const old = (await trash()).find((p) => p.slug === 'dup');
    expect(old, 'the first dup is in the trash').toBeTruthy();
    await tool('microsite.create', { slug: 'dup', title: 'second dup' });

    await expect(restore(old?.id ?? ''), 'the refusal names the slug').rejects.toThrow(/dup/);
    expect((await trash()).map((p) => p.slug), 'the refused page stays in the trash').toContain('dup');
  });

  test(`the purge job drops pages deleted more than ${TRASH_DAYS} days ago, with their builds`, async () => {
    await publishPage(request, csrf, 'oldpage', PAGE_APP, 300_000);
    await tool('microsite.create', { slug: 'freshpage', title: 'fresh' });
    await tool('microsite.delete', { slug: 'oldpage' });
    await tool('microsite.delete', { slug: 'freshpage' });
    const oldID = (await trash()).find((p) => p.slug === 'oldpage')?.id ?? '';
    execSQL(`UPDATE microsites SET updated_at = now() - interval '${TRASH_DAYS + 1} days' WHERE id = '${oldID}'`);

    await tool('tasks.run_periodic', { name: 'microsite trash purge' });

    await expect.poll(async () => (await trash()).map((p) => p.slug), { timeout: 30_000 })
      .not.toContain('oldpage');
    expect((await trash()).map((p) => p.slug), 'the fresh one stays').toContain('freshpage');
    expect(Number(querySQL(`SELECT count(*) FROM microsite_builds WHERE page_id = '${oldID}'`)),
      'its builds went with it').toBe(0);
    await expect(restore(oldID), 'a purged page is gone for good').rejects.toThrow(/not in the trash/i);
  });

  test('panel: the delete prompt names the trash; the trash restores the page', async ({ adminPage: page }) => {
    await tool('microsite.create', { slug: 'panelpage', title: 'panel page' });
    await gotoAdminSection(page, 'microsites');
    await page.getByTestId('microsite-delete-panelpage').click();
    await expect(page.getByText(/trash for 90 days/i), 'the prompt says where it goes').toBeVisible();
    await page.getByTestId('microsite-delete-confirm').click();
    await expect(page.getByTestId('microsite-delete-panelpage')).toHaveCount(0, { timeout: 15_000 });

    await gotoAdminSection(page, 'trash');
    const row = page.locator('[data-testid^="trash-microsite-row-"]').filter({ hasText: 'panelpage' });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.locator('[data-testid^="trash-microsite-restore-"]').click();
    await expect(row, 'a restored page leaves the trash').toHaveCount(0, { timeout: 15_000 });

    await gotoAdminSection(page, 'microsites');
    await expect(page.getByTestId('microsite-delete-panelpage'), 'the page is back in the list')
      .toBeVisible({ timeout: 15_000 });
  });
});
