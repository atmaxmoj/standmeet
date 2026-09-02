// admin-roles.spec.ts — /admin/roles UI-driven CRUD.
//
// User story:
//   1. after claim, the publicRow role is already seeded, appears in role-list with
//      [system] pill
//   2. owner clicks "+ new role" to open a modal → fills name + corpus URI globs →
//      create → the new role appears in the list
//   3. the publicRow's delete button is not rendered; a self-created role can be deleted
//   4. the corpus / skills / mcp / codes counts on the /admin/roles cards are correct

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';
import { createPrompt } from '@/fixtures/prompts';
import { createRole } from '@/fixtures/roles';
import { expectErrorToast, expectSuccessToast } from '@/fixtures/toast';

// #103: a prompt in the library + a non-builtin role to attach it to via the role card.
const PROMPT_NAME = 'greeter-persona';

const OWNER = {
  email: 'roles-admin@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'rolesadmin',
  fullName: 'Roles Admin Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('admin roles', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('public role seeded on claim is listed with [system] pill', async ({ adminPage }) => {
    await openRoles(adminPage);
    const publicRow = adminPage.getByTestId('role-row-public');
    await expect(publicRow).toBeVisible();
    await expect(publicRow.getByTestId('role-system-pill')).toBeVisible();
    // The public identity **has no allowlist**: it reads whatever the owner has
    // published, gated per-note by that note's own toggle (F-D-7). This used to assert
    // `3 URIs` — those three globs were a second, seeded dataset planted at claim time,
    // and they were exactly what let a codeless stranger read notes marked PRIVATE. The
    // card now states where the real scope actually comes from.
    await expect(publicRow.getByTestId('role-meta-corpus')).toContainText('what you published');
  });

  test('public role has no delete button', async ({ adminPage }) => {
    await openRoles(adminPage);
    const publicRow = adminPage.getByTestId('role-row-public');
    await expect(publicRow.getByTestId('role-delete-public')).toHaveCount(0);
  });

  test('create a new role via UI → appears in list', async ({ adminPage }) => {
    await openRoles(adminPage);
    await adminPage.getByTestId('role-new').click();
    const modal = adminPage.getByTestId('role-create-modal');
    await expect(modal).toBeVisible();
    await modal.getByTestId('role-field-name').fill('recruiter-default');
    await modal.getByTestId('role-field-description').fill('hiring loops');
    await modal.getByTestId('role-field-corpus-uris').fill(
      ['wiki://thinking/**', 'output://publicRow/**'].join('\n'),
    );
    await modal.getByTestId('role-create-submit').click();
    await expect(modal).not.toBeVisible({ timeout: 5_000 });
    const created = adminPage.getByTestId('role-row-recruiter-default');
    await expect(created).toBeVisible();
    await expect(created.getByTestId('role-meta-corpus')).toContainText('2 URIs');
  });

  // Failure-surfacing guard: when a duplicate-name create is rejected by the backend
  // (409), the owner must see an error toast, and the modal must stay open so they can
  // fix it — previously the mutation was swallowed into a plain `false`, the modal
  // closed regardless of success or failure, and a failure went silent as if it had
  // succeeded.
  test('duplicate role name → error toast + modal stays open (surfaced, not silent)', async ({ adminPage }) => {
    await openRoles(adminPage);
    await adminPage.getByTestId('role-new').click();
    const modal = adminPage.getByTestId('role-create-modal');
    await expect(modal).toBeVisible();
    // recruiter-default was already created in the previous test → the same name
    // must be rejected.
    await modal.getByTestId('role-field-name').fill('recruiter-default');
    await modal.getByTestId('role-field-description').fill('dup');
    await modal.getByTestId('role-field-corpus-uris').fill('wiki://thinking/**');
    await modal.getByTestId('role-create-submit').click();
    await expectErrorToast(adminPage, /already|exist|duplicate|taken|conflict|in use/i);
    await expect(modal, 'modal stays open on failure (not closed as if it saved)').toBeVisible();
    await adminPage.keyboard.press('Escape'); // clean up so it doesn't affect the delete test below
  });

  test('delete a non-builtin role', async ({ adminPage }) => {
    await openRoles(adminPage);
    // role created in prior test inside same describe block
    const row = adminPage.getByTestId('role-row-recruiter-default');
    await row.getByTestId('role-delete-recruiter-default').click();
    await expect(row).toHaveCount(0, { timeout: 5_000 });
  });

  test('#103 role card shows the attached-prompt picker and editing it persists',
    async ({ adminPage }) => {
      await openRoles(adminPage);
      const row = adminPage.getByTestId('role-row-greeter');
      await expect(row).toBeVisible({ timeout: 5_000 });
      const picker = row.getByTestId('role-prompt-greeter');
      // starts unattached (— none —)
      await expect(picker).toHaveValue('');
      // attach the library prompt by its visible name → wait for the success toast so the PUT has
      // landed before we reload (else the reload races the async updateRole and reads stale state).
      await picker.selectOption({ label: PROMPT_NAME });
      await expectSuccessToast(adminPage, /Prompt updated/);
      // reload the section → the choice persisted (PUT round-tripped prompt_id)
      await adminPage.reload();
      await openRoles(adminPage);
      const persisted = adminPage.getByTestId('role-row-greeter').getByTestId('role-prompt-greeter');
      await expect(persisted).not.toHaveValue('');
      const selected = await persisted.locator('option:checked').textContent();
      expect(selected).toContain(PROMPT_NAME);
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
  await createPrompt(request, csrf, { name: PROMPT_NAME, body: 'be warm and brief' });
  await createRole(request, csrf, { name: 'greeter', description: 'plain role' });
  await request.dispose();
}

async function openRoles(page: Page): Promise<void> {
  await gotoAdminSection(page, 'roles');
  await page.waitForURL('**/admin/roles', { timeout: 5_000 });
}
