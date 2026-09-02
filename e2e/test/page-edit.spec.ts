// page-edit.spec.ts -- admin edits public page content, and the visitor sees/experiences
// it right away.
//
// User story:
//   the owner has already claimed the instance, logs into admin, changes the default
//   hero prose to a sentence in their own words, and saves. Opening their public page
//   (/<handle>) and seeing that sentence is exactly what a visitor sees right now.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { expectAdminSidebarVisible, gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const NEW_HERO_PROSE =
  "I'm Alice. Newly edited hero prose to prove the page editor round-trip.";

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('owner edits public page, visitor sees the change', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('admin signs in, edits hero prose, save propagates to public page',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'page');
      await navigateToPageEditor(page);
      await editHeroProse(page, NEW_HERO_PROSE);
      await expectPublicPageShows(page, NEW_HERO_PROSE);
    });
});

async function navigateToPageEditor(page: Page): Promise<void> {
  // Already at /admin/page after login redirect.
  await expectAdminSidebarVisible(page);
  await expect(page.getByRole('link', { name: /\bapi · mcp\b/ })).toBeVisible();
}

async function editHeroProse(page: Page, prose: string): Promise<void> {
  const textarea = page.getByTestId('hero-prose');
  await expect(textarea).toBeVisible({ timeout: 5_000 });
  await textarea.fill(prose);
  await page.getByTestId('save').click();
  await expect(page.getByTestId('saved')).toBeVisible({ timeout: 5_000 });
}

async function expectPublicPageShows(page: Page, prose: string): Promise<void> {
  await page.getByRole('link', { name: 'view public ↗' }).click();
  await page.waitForURL('**/', { timeout: 10_000 });
  await expect(page.getByText(prose, { exact: false })).toBeVisible({ timeout: 5_000 });
}
