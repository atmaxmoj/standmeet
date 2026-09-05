// corpus-asset-pool-reuse-ui.spec.ts —— the owner cites a POOL asset (one uploaded to a different
// entry) into this entry's body from the panel, and on save the reference recompute records it —
// true reuse, driven from the browser. The recompute logic itself is covered in
// asset-reference-recompute.spec.ts; this proves the owner-facing entry point is actually wired.

import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { createEntry, uploadAsset, MEDIA } from '@/fixtures/genre-assets';
import { gotoAdminSection } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'pool-reuse@example.com', password: 'correct-horse-battery-staple',
  handle: 'poolreuse', fullName: 'Pool Reuse Owner',
};

let csrf = '';
let poolAssetID = '';
let holderFilename = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('corpus editor · reuse an asset from the pool', () => {
  test.beforeAll(async ({ playwright }) => {
    const asset = await seedPoolAsset(playwright);
    poolAssetID = asset.id;
    holderFilename = asset.filename;
  });

  test('pick a pool asset → it lands in the body → save references this entry too', async ({ adminPage: page }) => {
    await gotoAdminSection(page, 'wiki');
    const id = await createWikiEntry(page, 'Reuses a pool image');
    const prefix = `wiki-edit-form-${id}`;
    await expect(page.getByTestId(`wiki-edit-loaded-${id}`)).toBeVisible({ timeout: 15_000 });

    // Open the pool picker: it lists the asset uploaded to the OTHER entry, and inserting it
    // writes the stable standmeet-asset URI into the body.
    await page.getByTestId(`${prefix}-reuse-toggle`).click();
    const poolList = page.getByTestId(`${prefix}-pool-list`);
    await expect(poolList, 'the pool lists an asset from elsewhere').toBeVisible({ timeout: 15_000 });
    await expect(poolList).toContainText(holderFilename);

    await page.getByTestId(`${prefix}-pool-insert-${poolAssetID}`).click();
    await expect(page.getByTestId(`${prefix}-body`))
      .toHaveValue(new RegExp(`standmeet-asset:${poolAssetID}`));

    // Save → the recompute records this entry as a referrer of the pooled asset.
    await page.getByTestId(`${prefix}-submit`).click();
    await expect
      .poll(async () => refsInclude(page.request, poolAssetID, id), { timeout: 15_000 })
      .toBe(true);
  });
});

async function seedPoolAsset(
  playwright: Playwright,
): Promise<{ id: string; filename: string }> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  ({ csrf } = await loginAPI(request, OWNER.email, OWNER.password));
  const token = await createAPIToken(request, csrf, 'pool-reuse-seed');
  const sid = await initMCP(request, token);
  const holder = await createEntry({ request, token, sid }, 'wiki', 'Holder', 'body');
  const uploaded = await uploadAsset(
    { request, token, sid }, 'wiki', holder, MEDIA.pixel, { filename: 'shared.png' },
  );
  await request.dispose();
  return { id: uploaded.asset_id, filename: uploaded.original_filename };
}

// refsInclude —— does the pool asset now list this entry among its referrers? Uses the browser's
// own logged-in context (page.request), so it needs no CSRF header (a GET is a safe method).
async function refsInclude(
  request: APIRequestContext, assetID: string, entryID: string,
): Promise<boolean> {
  const res = await request.get(`${BACKEND}/api/admin/assets/${assetID}/references`);
  if (res.status() !== 200) return false;
  const refs = await res.json() as { referrer_id: string }[];
  return refs.some((r) => r.referrer_id === entryID);
}

// createWikiEntry —— new wiki entry on the panel, edit form open, returns its id.
async function createWikiEntry(page: Page, title: string): Promise<string> {
  await page.getByTestId('wiki-new-btn').click();
  await page.getByTestId('wiki-create-title').fill(title);
  await page.getByTestId('wiki-create-body').fill('a note that will reuse a pool asset');
  await page.getByTestId('wiki-create-submit').click();
  const row = page.locator('[data-testid^="wiki-row-"]').filter({ hasText: title }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  const testid = await row.getAttribute('data-testid');
  const id = (testid ?? '').replace('wiki-row-', '');
  expect(id, 'got the new entry id').not.toBe('');
  await page.getByTestId(`wiki-edit-${id}`).click();
  return id;
}
