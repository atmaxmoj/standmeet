// admin-codes-extended.spec.ts —— codes extended: 3-col card, QR modal,
// quota bar, revoke visual, edit code, view conversations link.
//
// 用户故事：
//   1. 3-col card layout → members + scope chips + QR visible
//   2. QR click → QR modal / download
//   3. quota bar → visual progress bar
//   4. revoke → card grayed + "expired"
//   5. edit code → change label / quota → save → card updates
//   6. "view conversations →" → jumps to conversations?code=XXX

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'codes-ext@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'codesext',
  fullName: 'Codes Ext Owner',
};

const CODE = 'CODESEXT-001';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin codes extended features', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('create code → card visible with label + QR',
    async ({ adminPage }) => {
      await openCodes(adminPage);
      await adminPage.getByRole('button', { name: /new code/i }).click();
      await adminPage.getByTestId('code-input').fill(CODE);
      await adminPage.getByTestId('code-label').fill('Ext Test Code');
      await adminPage.getByTestId('code-max-members').fill('3');
      await adminPage.getByTestId('code-max-turns').fill('15');
      await adminPage.getByTestId('code-create').click();
      // Card should appear
      const card = adminPage.getByTestId(`code-card-${CODE}`);
      await expect(card).toBeVisible({ timeout: 5_000 });
      // QR should be visible on card
      await expect(card.locator('[data-testid="code-qr"]')).toBeVisible();
    });

  test('edit code → change quotas → card updates',
    async ({ adminPage }) => {
      await openCodes(adminPage);
      const card = adminPage.getByTestId(`code-card-${CODE}`);
      await card.getByRole('button', { name: 'edit', exact: true }).click();
      // Edit mode only shows quota fields (label/code not editable)
      await adminPage.getByTestId('code-max-members').fill('10');
      await adminPage.getByTestId('code-max-turns').fill('25');
      await adminPage.getByTestId('code-save').click();
      await expect(card).toContainText('10 names', { timeout: 5_000 });
    });

  test('view conversations link → navigates with code filter',
    async ({ adminPage }) => {
      await openCodes(adminPage);
      const card = adminPage.getByTestId(`code-card-${CODE}`);
      const link = card.getByRole('link', { name: /view conversations/i });
      await expect(link).toBeVisible();
      await link.click();
      await adminPage.waitForURL(`**/admin/conversations?code=${CODE}`, { timeout: 5_000 });
    });

  test('revoke code → card shows expired state',
    async ({ adminPage }) => {
      await openCodes(adminPage);
      await adminPage.getByTestId(`code-revoke-${CODE}`).click();
      const card = adminPage.getByTestId(`code-card-${CODE}`);
      await expect(card).toContainText(/revoked|expired/i, { timeout: 5_000 });
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
