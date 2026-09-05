// drafts-manual-new.spec.ts —— the owner creates a resume draft by hand from the
// drafts panel (no job-loop, no Claude). This is the entry the owner asked for:
// "drafts 这边都没入口" — before this there was no way to start a draft from the UI.
//
// User story:
//   1. drafts section → "+ new draft" button
//   2. fill company + role → create
//   3. the draft card appears in the list with that company/role

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'manualdrafts@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'manualdrafts',
  fullName: 'Manual Drafts Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('drafts manual new', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('owner creates a draft by hand → card appears', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'drafts');
    await adminPage.waitForURL('**/admin/drafts', { timeout: 5_000 });
    await adminPage.getByRole('button', { name: /new draft/i }).click();
    await expect(adminPage.getByTestId('new-draft-form')).toBeVisible();
    await adminPage.getByTestId('new-draft-company').fill('Acme Robotics');
    await adminPage.getByTestId('new-draft-role').fill('Staff Engineer');
    await adminPage.getByTestId('new-draft-create').click();
    // the modal closes and the list reloads with the new draft
    await expect(adminPage.getByTestId('new-draft-form')).toBeHidden({ timeout: 5_000 });
    const card = adminPage.getByTestId('draft-card');
    await expect(card).toBeVisible({ timeout: 5_000 });
    await expect(card).toContainText('Acme Robotics');
    await expect(card).toContainText('Staff Engineer');
  });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}
