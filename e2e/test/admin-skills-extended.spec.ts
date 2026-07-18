// admin-skills-extended.spec.ts —— /admin/skills 的 my-skills CRUD：建 → 删。
//
// 这里曾经还测「heat-bar graph」「role label」「rebuild button」—— 那三样都是**编的/死的**已被移除
// （rot-A1 假热度图、rot-G1 死按钮）。对应的两条用例（skill-heat-bar / skill-role-label）是把断言
// 藏在 `if visible` 下的空转 test，永远绿、永远证明不了任何事（rot-E1/E2）—— 一并删掉，只留真的 CRUD。

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
