// account-edit.spec.ts — the three forms under /admin/account: full_name / email /
// password. Each save reads back from /me and writes it into sessionStore; the
// password save then logs in once with the new password.
//
// User story:
//   the owner wants to change the displayed full_name to something more casual;
//   change the email (verifying the current password first); change the password
//   (verifying the current password plus a confirmation). None of the three
//   affects the others' session.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const NEW_FULL_NAME = 'Alice A.';
const NEW_EMAIL = 'alice+rotated@example.com';
const NEW_PASSWORD = 'new-correct-horse-12345';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('owner edits account fields post-claim', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  // #115: the recovery phrase row is grey/enabled depending on SMTP (mail connector).
  // A fresh owner has no verified mail connector → grey state: detail "needs verified
  // email" + generate disabled (recoveryRowView holds the business logic, presentation
  // only renders it). Guards "without SMTP configured, the owner must not think they
  // can generate a recovery phrase".
  // Runs before the email/password edit test — that test rotates the owner's
  // credentials, and adminPage can't log in afterward with the old ones.
  test('recovery phrase row is SMTP-gated (grey) until a verified mail connector exists (#115)',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'account');
      await page.waitForURL('**/admin/account', { timeout: 5_000 });
      await expect(page.getByText('Recovery phrase')).toBeVisible();
      await expect(page.getByText('needs verified email')).toBeVisible();
      await expect(page.getByRole('button', { name: 'generate' })).toBeDisabled();
    });

  test('full name → email → password, each saved and re-readable',
    async ({ adminPage: page, playwright }) => {
      await gotoAdminSection(page, 'account');
      await page.waitForURL('**/admin/account', { timeout: 5_000 });

      await editFullName(page, NEW_FULL_NAME);
      await editEmail(page, OWNER.password, NEW_EMAIL);
      await editPassword(page, OWNER.password, NEW_PASSWORD);

      // Log in once via the API with the new email + password to verify the backend
      // actually made the change.
      const request = await playwright.request.newContext();
      const fresh = await loginAPI(request, NEW_EMAIL, NEW_PASSWORD);
      expect(fresh.csrf).toBeTruthy();
      await request.dispose();
    });
});

async function editFullName(page: Page, name: string): Promise<void> {
  const input = page.getByTestId('account-full-name-input');
  await input.fill(name);
  await page.getByTestId('account-full-name-save').click();
  await expect(page.getByTestId('toast-success').filter({ hasText: name })).toBeVisible();
  // After a reload, SectionHeader / FullNameBlock should re-read the new value from /me
  await page.reload();
  await expect(page.getByTestId('account-full-name-input')).toHaveValue(name);
}

async function editEmail(page: Page, currentPwd: string, newEmail: string): Promise<void> {
  await page.getByTestId('account-email-current-password').fill(currentPwd);
  await page.getByTestId('account-email-new').fill(newEmail);
  await page.getByTestId('account-email-save').click();
  await expect(page.getByTestId('toast-success').filter({ hasText: newEmail })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('account-email-new')).toHaveValue(newEmail);
}

async function editPassword(page: Page, currentPwd: string, newPwd: string): Promise<void> {
  await page.getByTestId('account-password-current').fill(currentPwd);
  await page.getByTestId('account-password-new').fill(newPwd);
  await page.getByTestId('account-password-confirm').fill(newPwd);
  await page.getByTestId('account-password-save').click();
  await expect(page.getByTestId('toast-success').filter({ hasText: /password updated/i }))
    .toBeVisible();
  // The field is cleared
  await expect(page.getByTestId('account-password-current')).toHaveValue('');
}

