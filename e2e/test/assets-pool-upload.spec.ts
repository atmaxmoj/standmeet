// assets-pool-upload.spec.ts —— **the owner can upload a file straight into the pool from the
// Assets panel**.
//
// This surface didn't exist: Resources → Assets was a viewer + delete only (its own comment said
// "Uploading … happen elsewhere — corpus slash command, microsite asset widget"). But the design
// (docs/design/global-assets.md) says uploading is pool-first — "Adding a new asset just puts it
// in the pool (owner-owned, unreferenced)" — and the owner asked for a real add entry here
// ("这里怎么还是没有新增入口"). The existing assets-manager-ui.spec seeds pool assets the roundabout
// way (attach to a note via MCP, then delete the note) precisely because no direct upload existed.
//
// So this drives the browser's real file picker (setInputFiles) on the panel's own upload control,
// and asserts the asset appears in the pool grid and — being unreferenced — is immediately
// deletable, exactly the "standalone upload (no holder)" row of the design's test matrix.

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const OWNER = {
  email: 'assets-pool@example.com', password: 'correct-horse-battery-staple',
  handle: 'assetspool', fullName: 'Assets Pool Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

// PNG_BYTES —— a valid 1×1 PNG (real bytes: the backend checks the declared type against the byte
// signature, so a fake .png would be rejected and we'd be testing the rejection path instead).
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('Resources → Assets · the owner uploads straight into the pool', () => {
  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    resetInstance();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('picking a file adds it to the pool grid, and it is immediately deletable', async ({
    adminPage: page,
  }) => {
    await page.getByTestId('admin-nav-assets').click();
    // starts empty — a fresh owner has never uploaded (proves the card below came from THIS upload)
    await expect(page.getByTestId('assets-empty')).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('assets-upload').setInputFiles({
      name: 'pool-shot.png', mimeType: 'image/png', buffer: PNG_BYTES,
    });

    // FilePicker's contract: the picked asset goes straight into the list (its own receipt).
    const grid = page.getByTestId('assets-list');
    await expect(grid).toBeVisible({ timeout: 15_000 });
    const cards = page.getByTestId(/^asset-card-/);
    await expect(cards).toHaveCount(1);
    await expect(grid).toContainText('pool-shot.png');

    // unreferenced (no holder, nothing cites it) → deletes cleanly and leaves the grid.
    await cards.first().getByRole('button').click();
    await expect(page.getByTestId('assets-empty')).toBeVisible({ timeout: 15_000 });
  });
});
