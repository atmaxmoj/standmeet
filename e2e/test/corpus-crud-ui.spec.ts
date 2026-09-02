// corpus-crud-ui.spec.ts — end-to-end CRUD across the raw / wiki / output genres, UI-driven.
//
// User story:
//   Owner doesn't open Claude Desktop, and instead works directly in the admin web UI:
//     1. On /admin/wiki, click "+ new wiki" → fill the form → save → it shows up in the list
//     2. Click "promote → output" on that same wiki row → fill the output title → save →
//        the new output shows up on /admin/output
//     3. Click "delete ×" on the output → confirm() → it's gone from the list
//   The whole chain is UI-driven, never touching MCP.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const WIKI_TITLE = 'Thinking about local-first software';
const WIKI_BODY = 'Local-first is mostly about ownership over data — not about offline.';
const OUTPUT_TITLE = 'Local-first ≠ offline (essay draft)';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('corpus CRUD: create wiki → promote to output → delete output', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('full CRUD chain UI-driven',
    async ({ adminPage: page }) => {
      await createWikiViaUI(page);
      await promoteWikiToOutputViaUI(page);
      await deleteOutputViaUI(page);
    });
});

async function createWikiViaUI(page: Page): Promise<void> {
  await gotoAdminSection(page, 'wiki');
  await page.waitForURL('**/admin/wiki', { timeout: 5_000 });
  await page.getByTestId('wiki-new-btn').click();
  await page.getByTestId('wiki-create-title').fill(WIKI_TITLE);
  await page.getByTestId('wiki-create-body').fill(WIKI_BODY);
  await page.getByTestId('wiki-create-submit').click();
  await expect(page.getByTestId('wiki-list')).toBeVisible();
  await expect(page.getByText(WIKI_TITLE, { exact: false })).toBeVisible();
}

async function promoteWikiToOutputViaUI(page: Page): Promise<void> {
  // Grab the promote button for the row just created: getByText finds the li with the
  // title, then chain into its promote button.
  const row = page.locator('[data-testid^="wiki-row-"]', { hasText: WIKI_TITLE });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /promote → output/i }).click();
  // The form appears: use a locator scoped to the row to hit the promote form's title field
  const titleInput = row.locator('[data-testid$="-title"]').first();
  await titleInput.fill(OUTPUT_TITLE);
  await row.getByRole('button', { name: /^promote$/i }).click();
  // Navigate to admin/output to see the new entry
  await gotoAdminSection(page, 'output');
  await page.waitForURL('**/admin/output', { timeout: 5_000 });
  await expect(page.getByTestId('output-list')).toBeVisible();
  await expect(page.getByText(OUTPUT_TITLE, { exact: false })).toBeVisible();
}

async function deleteOutputViaUI(page: Page): Promise<void> {
  page.once('dialog', (d) => void d.accept());
  const row = page.locator('[data-testid^="output-row-"]', { hasText: OUTPUT_TITLE });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /delete ×/i }).click();
  await expect(page.getByText(OUTPUT_TITLE, { exact: false })).toHaveCount(0, { timeout: 5_000 });
}
