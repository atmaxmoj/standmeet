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
import { expectErrorToast } from '@/fixtures/toast';

const OWNER = {
  email: 'codes-ext@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'codesext',
  fullName: 'Codes Ext Owner',
};

const CODE = 'CODESEXT-001';
const DUP_CODE = 'CODESEXT-DUP';

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
      // #30: 真 QR —— 密集 module 网格(qrcode-generator),不是稀疏伪花纹。
      expect(await card.locator('[data-testid="code-qr"] svg rect').count())
        .toBeGreaterThan(100);
      // #31: members 块只一份(之前 body + footer 各渲一次 → 两个 toggle)。
      await expect(card.getByTestId(`members-toggle-${CODE}`)).toHaveCount(1);
      // #32: expiry 显式标出(本码没设 expires_at → "no expiry")。
      const expiry = card.getByTestId('code-expiry');
      await expect(expiry).toBeVisible();
      await expect(expiry).toContainText(/expir/i);
    });

  // Failure-surfacing guard: `access_codes.code` is `citext UNIQUE` (schema.sql
  // :193). Creating a second code with the same `code` value violates the
  // constraint, CodeRepo.Create returns an error, and the handler maps it to a
  // 5xx (codes.go runCreateCode → serverErr). The admin API layer throws on any
  // non-2xx and CodesSection's onCreate catch → report(e) → error toast, while
  // onClose only runs on the success path so the modal (code-form) stays open.
  test('duplicate code value → error toast + create modal stays open',
    async ({ adminPage }) => {
      await openCodes(adminPage);
      await createCode(adminPage, DUP_CODE, 'First Dup Code');
      await expect(adminPage.getByTestId(`code-card-${DUP_CODE}`))
        .toBeVisible({ timeout: 5_000 });

      // Same `code` value again → unique violation surfaces as an error toast.
      await createCode(adminPage, DUP_CODE, 'Second Dup Code');
      await expectErrorToast(adminPage, /already|exist|duplicate|taken|conflict|fail/i);
      await expect(
        adminPage.getByTestId('code-form'),
        'create modal stays open on failure (not closed as if it saved)',
      ).toBeVisible();
      await adminPage.keyboard.press('Escape'); // tidy up so siblings start clean
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

// createCode —— open the "new code" modal, fill code + label, submit. Leaves the
// modal state as-is (open on failure, closed on success) for the caller to assert.
async function createCode(page: Page, code: string, label: string): Promise<void> {
  await page.getByRole('button', { name: /new code/i }).click();
  await expect(page.getByTestId('code-form')).toBeVisible({ timeout: 5_000 });
  await page.getByTestId('code-input').fill(code);
  await page.getByTestId('code-label').fill(label);
  await page.getByTestId('code-create').click();
}
