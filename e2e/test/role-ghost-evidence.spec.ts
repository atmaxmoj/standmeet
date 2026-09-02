// role-ghost-evidence.spec.ts -- F-A-10, the admin UI toggle for "content-style ghost
// prompts must carry corpus evidence", round-tripped on both the role side and the
// code-override side.
//
// Guards three things:
//  1. the toggle on the role card persists (turn it on -> reload -> still on);
//  2. **zeroing regression**: after turning it on, saving the dock (a sibling save)
//     must not clear require_ghost_evidence back to zero -- before the fix (the dock
//     payload didn't carry require_ghost_evidence) this went RED;
//  3. the code override's 3 states (inherit/on/off) round-trip: an explicit override
//     persists, and inherit clears the override and falls back to the role.

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';
import { expectSuccessToast } from '@/fixtures/toast';

const OWNER = {
  email: 'ghost-evidence@example.com', password: 'correct-horse-battery-staple',
  handle: 'ghostev', fullName: 'Ghost Evidence Owner',
};
const CODE = 'GEV-777';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('F-A-10 · ghost-evidence rule — role toggle + code override', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('role toggle: off by default → turn on → save → reload → persists',
    async ({ adminPage }) => {
      await openRoles(adminPage);
      const row = adminPage.getByTestId('role-row-steerer');
      await expect(row.getByTestId('role-ghost-evidence-toggle')).not.toBeChecked();
      await row.getByTestId('role-ghost-evidence-toggle').check();
      await row.getByTestId('role-ghost-save').click();
      await expectSuccessToast(adminPage, /ghost/i);
      await adminPage.reload();
      await openRoles(adminPage);
      await expect(
        adminPage.getByTestId('role-row-steerer').getByTestId('role-ghost-evidence-toggle'),
      ).toBeChecked();
    });

  test('sibling dock save does NOT zero the ghost rule (zeroing regression guard)',
    async ({ adminPage }) => {
      await openRoles(adminPage);
      const row = adminPage.getByTestId('role-row-steerer');
      // Precondition: the previous test already turned the toggle on and persisted it.
      // Here we save the dock (a full sibling PUT).
      await expect(row.getByTestId('role-ghost-evidence-toggle')).toBeChecked();
      await row.getByTestId('role-dock-save').click();
      await expectSuccessToast(adminPage, /dock/i);
      await adminPage.reload();
      await openRoles(adminPage);
      // After the dock save, the ghost rule must still be there (before the fix, the
      // dock payload never sent it back -> this went RED).
      await expect(
        adminPage.getByTestId('role-row-steerer').getByTestId('role-ghost-evidence-toggle'),
      ).toBeChecked();
    });

  test('code override: inherit → off → reload persists → back to inherit',
    async ({ adminPage }) => {
      await openCodes(adminPage);
      const sel = adminPage.getByTestId(`code-ghost-evidence-${CODE}`);
      await expect(sel).toHaveValue('inherit');
      await sel.selectOption('off');
      await expectSuccessToast(adminPage, /ghost/i);
      await adminPage.reload();
      await openCodes(adminPage);
      await expect(adminPage.getByTestId(`code-ghost-evidence-${CODE}`)).toHaveValue('off');
      // Back to inherit: clears the override, and the value goes back to inheriting
      // from the role.
      await adminPage.getByTestId(`code-ghost-evidence-${CODE}`).selectOption('inherit');
      await expectSuccessToast(adminPage, /ghost/i);
      await adminPage.reload();
      await openCodes(adminPage);
      await expect(adminPage.getByTestId(`code-ghost-evidence-${CODE}`)).toHaveValue('inherit');
    });

  // Editing the role description goes through the SAME centralized `roleUpdatePayload`, so it is
  // both a feature check (description is editable post-creation) AND a second zeroing guard: after
  // test 1 turned the ghost rule ON, a description save must NOT drop it.
  test('description editable: edit → save → reload persists, ghost rule survives the save',
    async ({ adminPage }) => {
      await openRoles(adminPage);
      const row = adminPage.getByTestId('role-row-steerer');
      await expect(row.getByTestId('role-ghost-evidence-toggle')).toBeChecked();
      await row.getByTestId('role-desc-input-steerer').fill('recruiters at Series-B startups');
      await row.getByTestId('role-desc-save-steerer').click();
      await expectSuccessToast(adminPage, /about/i);
      await adminPage.reload();
      await openRoles(adminPage);
      const back = adminPage.getByTestId('role-row-steerer');
      await expect(back.getByTestId('role-desc-input-steerer'))
        .toHaveValue('recruiters at Series-B startups');
      await expect(back.getByTestId('role-ghost-evidence-toggle')).toBeChecked();
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const role = await createRole(request, csrf, {
    name: 'steerer', description: 's', corpus_uris: ['wiki://**'],
  });
  await createCode(request, csrf, {
    code: CODE, label: 'evidence code', assumed_role_id: role.id,
  });
  await request.dispose();
}

async function openRoles(page: Page): Promise<void> {
  await gotoAdminSection(page, 'roles');
  await page.waitForURL('**/admin/roles', { timeout: 5_000 });
  await expect(page.getByTestId('role-row-steerer')).toBeVisible({ timeout: 5_000 });
}

async function openCodes(page: Page): Promise<void> {
  await gotoAdminSection(page, 'codes');
  await page.waitForURL('**/admin/codes', { timeout: 5_000 });
  await expect(page.getByTestId(`code-card-${CODE}`)).toBeVisible({ timeout: 5_000 });
}
