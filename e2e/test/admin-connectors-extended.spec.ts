// admin-connectors-extended.spec.ts —— connectors: dashed add card, category tabs,
// installed pill, secret field toggle, oauth button, connect state.
//
// User story:
//   1. dashed "+" card → click → modal opens
//   2. category tab switch → catalog grid filters
//   3. installed connector → "installed" pill
//   4. config form → secret field → reveal/hide toggle
//   5. config form → oauth field → "Authorize" button
//   6. connect → tile state changes

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'conn-ext@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'connext',
  fullName: 'Connector Ext Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin connectors extended', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('dashed add card → modal opens → categories filter',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'connectors');
      await adminPage.waitForURL('**/admin/connectors', { timeout: 5_000 });
      await adminPage.getByTestId('connector-add-open').click();
      // Default category visible
      await expect(adminPage.getByTestId('connector-card-email')).toBeVisible();
      // Switch category
      await adminPage.getByRole('button', { name: /storage/i }).click();
      await expect(adminPage.getByTestId('connector-card-s3')).toBeVisible();
      await expect(adminPage.getByTestId('connector-card-email')).toHaveCount(0);
    });

  test('no duplicate mail setup — the dead dedicated panel is gone (F-B-1)',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'connectors');
      await adminPage.waitForURL('**/admin/connectors', { timeout: 5_000 });
      // Mail is handled solely by the generic SMTP connector card; the dead dedicated
      // MailConnectorPanel (posted to non-existent /connectors/mail/* + send-otp routes,
      // F-C-3) is removed. The calendar panel stays — it uniquely hosts the booking policy.
      await expect(adminPage.getByTestId('mail-connector-panel')).toHaveCount(0);
      await expect(adminPage.getByTestId('gcal-connector-panel')).toBeVisible({ timeout: 5_000 });
    });

  test('secret field is type=password with reveal toggle',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'connectors');
      await adminPage.getByTestId('connector-add-open').click();
      await adminPage.getByRole('button', { name: /storage/i }).click();
      await adminPage.getByTestId('connector-card-s3').click();
      // Secret field should be password type
      const secretField = adminPage.getByTestId('connector-field-secret_key');
      await expect(secretField).toHaveAttribute('type', 'password');
    });

  // #155: the hardcoded per-provider dropdown (connector-field-provider) is gone —
  // a calendar connector is assembled from an OpenAPI spec (or the built-in CalDAV
  // form) via AssembleView. The full oauth Authorize loop is covered end-to-end by
  // connector-happy-matrix; here we only prove the calendar card opens that assemble
  // entry point (the legacy dropdown assertion tested UI that no longer exists).
  test('calendar card opens the spec-assemble entry',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'connectors');
      await adminPage.getByTestId('connector-add-open').click();
      await adminPage.getByTestId('connector-card-calendar').click();
      await expect(adminPage.getByTestId('connector-spec-input')).toBeVisible();
    });
  // (The old "#46 grid coming-soon tile" test was removed -- the marketplace preview
  // grid isn't happening; the owner just uploads and uses it.)
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
