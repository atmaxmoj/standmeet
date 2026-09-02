// admin-prompts.spec.ts —— /admin/prompts UI-driven CRUD。
//
// User story:
//   1. After claim, the publicRow prompt is already seeded; the list includes a [system] pill
//   2. Owner creates a prompt → it appears in the list, body preview renders
//   3. publicRow has no delete button; a self-created prompt can be deleted

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';
import { expectErrorToast } from '@/fixtures/toast';

const OWNER = {
  email: 'prompts-admin@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'promptsadmin',
  fullName: 'Prompts Admin Owner',
};

const DUP_NAME = 'dup-persona';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('admin prompts', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('public prompt seeded on claim is listed with [system] pill', async ({ adminPage }) => {
    await openPrompts(adminPage);
    const publicRow = adminPage.getByTestId('prompt-row-public');
    await expect(publicRow).toBeVisible();
    await expect(publicRow.getByTestId('prompt-system-pill')).toBeVisible();
  });

  test('public prompt has no delete button', async ({ adminPage }) => {
    await openPrompts(adminPage);
    const publicRow = adminPage.getByTestId('prompt-row-public');
    await expect(publicRow.getByTestId('prompt-delete-public')).toHaveCount(0);
  });

  test('create + delete a non-builtin prompt', async ({ adminPage }) => {
    await openPrompts(adminPage);
    await adminPage.getByTestId('prompt-new').click();
    const modal = adminPage.getByTestId('prompt-create-modal');
    await expect(modal).toBeVisible();
    await modal.getByTestId('prompt-field-name').fill('recruiter-facing');
    await modal.getByTestId('prompt-field-description').fill('direct, leads with substance');
    await modal.getByTestId('prompt-field-body').fill(
      'You are answering recruiters as the owner\'s proxy. Be direct.',
    );
    await modal.getByTestId('prompt-create-submit').click();
    await expect(modal).not.toBeVisible({ timeout: 5_000 });
    const created = adminPage.getByTestId('prompt-row-recruiter-facing');
    await expect(created).toBeVisible();
    await created.getByTestId('prompt-delete-recruiter-facing').click();
    await expect(created).toHaveCount(0, { timeout: 5_000 });
  });

  // Failure-surfacing guard: `prompts` has a UNIQUE index on (owner_id, name)
  // (schema.sql prompts_owner_name_uniq). A second prompt with the same name
  // returns domain.ErrPromptNameTaken, which the handler maps to HTTP 409
  // `prompt_name_taken` (prompts.go createPromptErrCases). The admin API throws
  // on non-2xx; PromptsSection's submit catch → report(e) → error toast, and
  // onClose only runs on success so the create modal stays open to let owner fix.
  test('duplicate prompt name → error toast + create modal stays open',
    async ({ adminPage }) => {
      await openPrompts(adminPage);
      await createPrompt(adminPage, DUP_NAME, 'first with this name');
      await expect(adminPage.getByTestId(`prompt-row-${DUP_NAME}`))
        .toBeVisible({ timeout: 5_000 });

      // Same name again → 409 surfaces as an error toast, modal stays open.
      await createPrompt(adminPage, DUP_NAME, 'second with this name');
      await expectErrorToast(adminPage, /already|exist|duplicate|taken|conflict|fail/i);
      await expect(
        adminPage.getByTestId('prompt-create-modal'),
        'create modal stays open on failure (not closed as if it saved)',
      ).toBeVisible();
      await adminPage.keyboard.press('Escape'); // tidy up for sibling tests
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

async function openPrompts(page: Page): Promise<void> {
  await gotoAdminSection(page, 'prompts');
  await page.waitForURL('**/admin/prompts', { timeout: 5_000 });
}

// createPrompt —— open the create modal, fill name + body (both required to
// enable submit), submit. Leaves modal open on failure / closed on success.
async function createPrompt(page: Page, name: string, body: string): Promise<void> {
  await page.getByTestId('prompt-new').click();
  const modal = page.getByTestId('prompt-create-modal');
  await expect(modal).toBeVisible({ timeout: 5_000 });
  await modal.getByTestId('prompt-field-name').fill(name);
  await modal.getByTestId('prompt-field-body').fill(body);
  await modal.getByTestId('prompt-create-submit').click();
}
