// admin-codes-with-role.spec.ts —— the role dropdown on the code create modal +
// the role link + (frozen) label on CodeCard. This is where A.3-IAM-3 lands.
//
// User story:
//   The owner wants to give a recruiter a code → picks the already-built role
//   "recruiter-default" → issues the code → the list card's role field shows a
//   public / recruiter-default link + the small "issued with role (frozen)" text.

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'codes-role@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'codesrole',
  fullName: 'Codes Role Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('issue code with assumed_role_id', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('code create modal exposes role dropdown including public',
    async ({ adminPage }) => {
      await openCodes(adminPage);
      await adminPage.getByRole('button', { name: /new code/i }).click();
      const dropdown = adminPage.getByTestId('code-field-role');
      await expect(dropdown).toBeVisible();
      // useRoles fetches on modal mount; await the public option appearing.
      await expect(dropdown.locator('option', { hasText: 'public' }))
        .toHaveCount(1, { timeout: 5_000 });
    });

  test('issue code with public role → CodeCard shows role link + (frozen)',
    async ({ adminPage }) => {
      await openCodes(adminPage);
      await adminPage.getByRole('button', { name: /new code/i }).click();
      await adminPage.getByTestId('code-input').fill('RECR-001');
      await adminPage.getByTestId('code-label').fill('recruiter loop');
      const dropdown = adminPage.getByTestId('code-field-role');
      // useRoles fetches on modal mount; await public option before selecting.
      await expect(dropdown.locator('option', { hasText: 'public' }))
        .toHaveCount(1, { timeout: 5_000 });
      await dropdown.selectOption({ label: 'public' });
      await adminPage.getByTestId('code-create').click();
      const row = adminPage.getByTestId('code-row-RECR-001');
      await expect(row).toBeVisible({ timeout: 5_000 });
      await expect(row.getByTestId('code-role-frozen')).toBeVisible();
      // the frozen line should contain the text "issued with role"
      await expect(row.getByTestId('code-role-frozen')).toContainText('frozen');

      // **What the link actually says**: this case originally only asserted the link was
      // present, never checked what it displayed, so the card kept printing a truncated
      // UUID (`e1db285a…`) that nobody noticed. The role's name is what the owner chose
      // themselves — it's the only clue to "who this code is meant for"; a truncated ID
      // forces the owner to go cross-reference it against /admin/roles one by one.
      const link = row.locator('[data-testid^="code-role-"]').and(row.locator('a'));
      await expect(link, 'the card names the role').toHaveText(/public/, { timeout: 5_000 });
      await expect(link, 'and never shows a raw UUID').not.toHaveText(/[0-9a-f]{8}…/);
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

async function openCodes(page: Page): Promise<void> {
  await gotoAdminSection(page, 'codes');
  await page.waitForURL('**/admin/codes', { timeout: 5_000 });
}
