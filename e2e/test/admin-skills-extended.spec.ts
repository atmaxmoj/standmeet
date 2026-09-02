// admin-skills-extended.spec.ts -- /admin/skills my-skills CRUD: create -> delete.
//
// This file used to also test "heat-bar graph", "role label", and "rebuild button" --
// all three were **fabricated/dead** and have been removed (rot-A1 fake heat graph,
// rot-G1 dead button). The two matching test cases (skill-heat-bar / skill-role-label)
// hid their assertions inside `if visible`, an inert test that stays green forever and
// never proves anything (rot-E1/E2) -- deleted along with them, leaving only real CRUD.

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'skills-ext@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'skillsext',
  fullName: 'Skills Ext Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin skills extended features', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('builtin skills render in the my-skills list',
    async ({ adminPage }) => {
      await openSkills(adminPage);
      await expect(adminPage.getByTestId('skill-row-code-review')).toBeVisible();
    });

  test('delete custom skill → row disappears',
    async ({ adminPage }) => {
      await openSkills(adminPage);
      // Create a skill to delete
      await adminPage.getByRole('button', { name: /new skill/i }).click();
      await adminPage.getByTestId('skill-field-name').fill('to-delete');
      await adminPage.getByTestId('skill-field-description').fill('Will be deleted.');
      await adminPage.getByTestId('skill-field-prompt').fill('Delete me.');
      await adminPage.getByTestId('skill-create-submit').click();
      await expect(adminPage.getByTestId('skill-row-to-delete'))
        .toBeVisible({ timeout: 5_000 });
      // Delete it
      adminPage.once('dialog', (d) => void d.accept());
      await adminPage.getByTestId('skill-delete-to-delete').click();
      await expect(adminPage.getByTestId('skill-row-to-delete'))
        .toHaveCount(0, { timeout: 5_000 });
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

async function openSkills(page: Page): Promise<void> {
  await gotoAdminSection(page, 'skills');
  await page.waitForURL('**/admin/skills', { timeout: 5_000 });
}
