// supplier-add-modal.spec.ts —— the "+ add" modal on /admin/suppliers:
// the 18-entry SUPPLIER_REGISTRY filtered by 5 category tabs + a dynamic config form.
//
// Business story: the owner wants to connect Notion / Calendar / S3 or any new supplier →
// clicks "+ add supplier" → picks a category tab → clicks a catalog card → fields[] renders
// the form automatically → connect. GCal booking follows this exact path — appending an
// entry to the registry, and the UI picks it up automatically.

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin /suppliers · add modal + dynamic config form', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('"+ add supplier" → modal → catalog → category tab → connect',
    async ({ adminPage }) => {
      await openSuppliers(adminPage);
      await adminPage.getByTestId('supplier-add-open').click();
      // The catalog defaults to the comms category; the first entry is email
      await expect(adminPage.getByTestId('supplier-card-email')).toBeVisible();
      // Switch to the storage category
      await adminPage.getByRole('button', { name: /storage & backup/i }).click();
      await expect(adminPage.getByTestId('supplier-card-s3')).toBeVisible();
      // Open the s3 config form
      await adminPage.getByTestId('supplier-card-s3').click();
      // fields render dynamically: endpoint / bucket / access_key (secret) / secret_key (secret)
      await adminPage.getByTestId('supplier-field-endpoint').fill('s3.amazonaws.com');
      await adminPage.getByTestId('supplier-field-bucket').fill('my-backup');
      await adminPage.getByTestId('supplier-field-access_key').fill('AKIA-fake');
      await adminPage.getByTestId('supplier-field-secret_key').fill('secret-fake');
      await adminPage.getByTestId('supplier-config-save').click();
      // The modal closes
      await expect(adminPage.getByTestId('supplier-add-open')).toBeVisible({ timeout: 3_000 });
    });

  test('calendar card → normalized assemble view (OpenAPI upload + built-in CalDAV form)',
    async ({ adminPage }) => {
      await openSuppliers(adminPage);
      await adminPage.getByTestId('supplier-add-open').click();
      // After normalization: calendar is no longer a hardcoded provider dropdown (the legacy
      // one was removed) — it's an assembly view instead, able to either paste an OpenAPI
      // spec to assemble a per-SaaS supplier, or fill in the built-in CalDAV protocol's fixed form.
      await adminPage.getByTestId('supplier-card-calendar').click();
      await expect(adminPage.getByTestId('supplier-spec-input')).toBeVisible();
      await expect(adminPage.getByTestId('supplier-field-url')).toBeVisible();
      // The secret field is masked as password.
      await expect(adminPage.getByTestId('supplier-field-password'))
        .toHaveAttribute('type', 'password');
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await loginAPI(request, OWNER.email, OWNER.password);
  await request.dispose();
}

async function openSuppliers(page: Page): Promise<void> {
  await gotoAdminSection(page, 'suppliers');
  await page.waitForURL('**/admin/suppliers');
}
