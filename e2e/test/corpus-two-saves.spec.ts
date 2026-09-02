// corpus-two-saves.spec.ts — one screen, two submits, and each one must name which
// half it owns (UX-60).
//
// The shape of the defect: the wiki edit screen is two stacked cards — on top,
// CorpusEntryForm (title/body/tags/cover); below, PUBLIC LANDING (excerpt +
// published). **They each have their own submit, writing different backend calls**,
// but both buttons originally just said `save`. After filling in the bottom card, an
// owner's most natural move is to press the bigger, more prominent solid button up
// top — which does nothing for the bottom half. There's no on-screen boundary hint,
// and no "unsaved" marker either.
//
// What this guards is **each button naming its own half**. That's the only
// information an owner has to judge "which one do I press", so it's a product
// behavior, not a copy preference: reverting to `save` / `save` reinstalls that
// exact mis-click.
//
// Why not assert "pressed the top one, the bottom one didn't save": that would be
// building the case on the defect itself — it would still hold true after the fix
// (the two submits are supposed to each handle their own half). The criterion that
// actually flips with the fix is **whether each button says clearly what it does**.

import type { Page, Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';
import { test, expect } from '@/fixtures/test';

const OWNER = {
  email: 'twosaves@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'twosaves',
  fullName: 'Two Saves Owner',
};

const TITLE = 'Entry With A Landing Card';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe.configure({ mode: 'serial' });
test.describe('corpus · two submits on one screen, each says which half it saves', () => {
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('the entry submit and the landing submit name their own half', async ({ adminPage }) => {
    await createEntry(adminPage);
    const id = await openEditForm(adminPage, TITLE);

    const entrySave = adminPage.getByTestId(`wiki-edit-form-${id}-submit`);
    const landingSave = adminPage.getByTestId(`wiki-${id}-seo-save`);
    await expect(landingSave, 'the landing card carries its own submit').toBeVisible();

    // Both are present, both visible — then each one's label must state clearly
    // which half it owns.
    await expect(
      entrySave,
      'the entry submit must say it saves the entry, not just "save"',
    ).toHaveText(/save\s+entry/i);
    await expect(
      landingSave,
      'the landing submit must say it saves the landing, not just "save"',
    ).toHaveText(/save\s+landing/i);
  });
});

async function createEntry(page: Page): Promise<void> {
  await gotoAdminSection(page, 'wiki');
  await page.getByTestId('wiki-new-btn').click();
  await page.getByTestId('wiki-create-title').fill(TITLE);
  await page.getByTestId('wiki-create-body').fill('Something with a public landing side.');
  await page.getByTestId('wiki-create-submit').click();
  await expect(page.getByText(TITLE).first()).toBeVisible({ timeout: 5_000 });
}

// openEditForm — expands this row's edit form and returns its id. The form is lazy
// loaded: opening it shows loading… first, so wait for `wiki-edit-loaded-${id}`,
// don't act the moment a field becomes visible.
async function openEditForm(page: Page, title: string): Promise<string> {
  await gotoAdminSection(page, 'wiki');
  const row = page.locator('[data-testid^="wiki-row-"]', { hasText: title });
  await expect(row).toBeVisible({ timeout: 10_000 });
  const id = (await row.getAttribute('data-testid'))!.replace('wiki-row-', '');
  await page.getByTestId(`wiki-edit-${id}`).click();
  await expect(page.getByTestId(`wiki-edit-loaded-${id}`)).toBeVisible({ timeout: 15_000 });
  return id;
}
