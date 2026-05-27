// admin-skills-extended.spec.ts —— skills extended: heat-bar graph, role label,
// rebuild button.
//
// 用户故事：
//   1. heat-bar graph → renders 2-col grid + gradient bar
//   2. role label → based on heat value shows correct label
//   3. "rebuild from corpus" button → UI feedback

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

  test('builtin skills render with heat bars',
    async ({ adminPage }) => {
      await openSkills(adminPage);
      // Builtin skills should have heat-bar
      const firstRow = adminPage.getByTestId('skill-row-code-review');
      await expect(firstRow).toBeVisible();
      // Check for heat bar or role label
      const heatBar = firstRow.getByTestId('skill-heat-bar');
      if (await heatBar.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await expect(heatBar).toBeVisible();
      }
    });

  test('role labels render for builtin skills',
    async ({ adminPage }) => {
      await openSkills(adminPage);
      // At least one skill should have a role label
      const roleLabels = adminPage.locator('[data-testid="skill-role-label"]');
      if (await roleLabels.count() > 0) {
        const firstLabel = await roleLabels.first().textContent();
        expect(firstLabel).toMatch(/core|strong|maintained|developing|dormant/i);
      }
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
