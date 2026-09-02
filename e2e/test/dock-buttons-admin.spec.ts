// dock-buttons-admin.spec.ts — #109/#110 F: the admin UI where an owner configures
// dock buttons on a role card.
//
// Two fixed button slots (= two chat positions). Each slot = a capability dropdown
// (options = that role's capabilities, labeled by MCP title) + a trigger-phrase
// input + a "trigger phrase" help caption (against confusion). Save → frozen into
// subsequent sessions.

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';
import { expectErrorToast, expectSuccessToast } from '@/fixtures/toast';

const OWNER = {
  email: 'dock-admin@example.com', password: 'correct-horse-battery-staple',
  handle: 'dockadmin', fullName: 'Dock Admin Owner',
};
const CAP_SUMMARIZE = 'summarize_conversation';
const TRIGGER = 'Summarize our conversation so far';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('dock buttons · F — admin role-card config UI', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('F1 role card exposes two dock slots (cap select + trigger) with a 触发词 helper',
    async ({ adminPage }) => {
      await openRoles(adminPage);
      const row = adminPage.getByTestId('role-row-greeter');
      await expect(row).toBeVisible({ timeout: 5_000 });
      // The help caption must be present (otherwise an owner seeing "trigger
      // phrase" would be confused).
      await expect(row.getByTestId('role-dock-help')).toBeVisible();
      await expect(row.getByTestId('role-dock-cap-0')).toBeVisible();
      await expect(row.getByTestId('role-dock-trigger-0')).toBeVisible();
      await expect(row.getByTestId('role-dock-cap-1')).toBeVisible();
    });

  test('F2 configure slot 0 → save → reload → persists',
    async ({ adminPage }) => {
      await openRoles(adminPage);
      const row = adminPage.getByTestId('role-row-greeter');
      await row.getByTestId('role-dock-cap-0').selectOption(CAP_SUMMARIZE);
      await row.getByTestId('role-dock-trigger-0').fill(TRIGGER);
      await row.getByTestId('role-dock-save').click();
      await expectSuccessToast(adminPage, /dock/i);
      await adminPage.reload();
      await openRoles(adminPage);
      const back = adminPage.getByTestId('role-row-greeter');
      await expect(back.getByTestId('role-dock-cap-0')).toHaveValue(CAP_SUMMARIZE);
      await expect(back.getByTestId('role-dock-trigger-0')).toHaveValue(TRIGGER);
    });

  test('F3 a slot with a capability but an empty trigger → save rejected → error toast',
    async ({ adminPage }) => {
      await openRoles(adminPage);
      const row = adminPage.getByTestId('role-row-recruiter');
      await row.getByTestId('role-dock-cap-0').selectOption(CAP_SUMMARIZE);
      await row.getByTestId('role-dock-trigger-0').fill('');
      await row.getByTestId('role-dock-save').click();
      await expectErrorToast(adminPage, /trigger|触发词/i);
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
  await createRole(request, csrf, { name: 'greeter', description: 'g', corpus_uris: ['wiki://**'] });
  await createRole(request, csrf, { name: 'recruiter', description: 'r', corpus_uris: ['wiki://**'] });
  await request.dispose();
}

async function openRoles(page: Page): Promise<void> {
  await gotoAdminSection(page, 'roles');
  await page.waitForURL('**/admin/roles', { timeout: 5_000 });
}
