// assets-manager-ui.spec.ts —— the owner-facing Assets manager (Resources → Assets) actually
// works from the browser: the pool renders, an unreferenced asset deletes and leaves the grid,
// and a referenced one refuses (stays in the grid) — the delete guard surfaced through the real
// page, not only the API (the 409 body + 204 are proven in global-assets-guard.spec.ts).

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI, createAPIToken } from '@/fixtures/admin';
import { initMCP, callTool } from '@/fixtures/mcp';
import { createEntry, uploadAsset, MEDIA } from '@/fixtures/genre-assets';

const OWNER = {
  email: 'assets-ui@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'assetsui',
  fullName: 'Assets UI Owner',
};

// referenced stays in the pool (a note still cites it); unreferenced is free to delete.
let referenced = '';
let unreferenced = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('Resources → Assets · the owner manages the pool from the browser', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimFreshOwner(playwright, OWNER);
    ({ referenced, unreferenced } = await seedAssets(playwright));
  });

  test('an unreferenced asset deletes; a referenced one refuses and stays', async ({ adminPage: page }) => {
    await page.getByTestId('admin-nav-assets').click();
    await expect(page.getByTestId('assets-list')).toBeVisible({ timeout: 15_000 });

    const refCard = page.getByTestId(`asset-card-${referenced}`);
    const freeCard = page.getByTestId(`asset-card-${unreferenced}`);
    await expect(refCard, 'both seeded assets are in the pool').toBeVisible();
    await expect(freeCard).toBeVisible();

    // delete the unreferenced one → it leaves the grid
    await page.getByTestId(`asset-delete-${unreferenced}`).click();
    await expect(freeCard, 'an unreferenced asset deletes and disappears')
      .toBeHidden({ timeout: 15_000 });

    // delete the referenced one → refused, so it stays (the guard surfaced in the UI)
    await page.getByTestId(`asset-delete-${referenced}`).click();
    await expect(refCard, 'a referenced asset refuses delete and stays in the grid')
      .toBeVisible({ timeout: 5_000 });
  });
});

async function seedAssets(
  playwright: Playwright,
): Promise<{ referenced: string; unreferenced: string }> {
  const request = await playwright.request.newContext();
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'assets-ui-seed');
  const sid = await initMCP(request, token);
  const s = { request, token, sid };

  const keep = await createEntry(s, 'wiki', 'Keeper', 'body');
  const ref = (await uploadAsset(s, 'wiki', keep, MEDIA.pixel)).asset_id;

  const doomed = await createEntry(s, 'wiki', 'Doomed', 'body');
  const free = (await uploadAsset(s, 'wiki', doomed, MEDIA.gif)).asset_id;
  // delete the holder → its asset is now unreferenced (survives in the pool, free to delete)
  await callTool(request, token, sid, 'corpus.delete', { genre: 'wiki', id: doomed });

  await request.dispose();
  return { referenced: ref, unreferenced: free };
}
