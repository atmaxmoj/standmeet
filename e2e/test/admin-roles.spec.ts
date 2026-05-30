// admin-roles.spec.ts —— /admin/roles UI-driven CRUD。
//
// 用户故事：
//   1. claim 后 vanilla role 已种入，appears in role-list with [system] pill
//   2. owner 点 "+ new role" 弹 modal → 填 name + corpus URI globs → create →
//      新 role 出现在 list
//   3. vanilla 的 delete 按钮不渲染；自建 role 可删
//   4. /admin/roles 卡上的 corpus / skills / mcp / codes 计数正确

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

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

  test('vanilla role seeded on claim is listed with [system] pill', async ({ adminPage }) => {
    await openRoles(adminPage);
    const vanilla = adminPage.getByTestId('role-row-vanilla');
    await expect(vanilla).toBeVisible();
    await expect(vanilla.getByTestId('role-system-pill')).toBeVisible();
    // vanilla 三 public glob：writing/wiki/output —— "3 URIs"
    await expect(vanilla.getByTestId('role-meta-corpus')).toContainText('3 URIs');
  });

  test('vanilla role has no delete button', async ({ adminPage }) => {
    await openRoles(adminPage);
    const vanilla = adminPage.getByTestId('role-row-vanilla');
    await expect(vanilla.getByTestId('role-delete-vanilla')).toHaveCount(0);
  });

  test('create a new role via UI → appears in list', async ({ adminPage }) => {
    await openRoles(adminPage);
    await adminPage.getByTestId('role-new').click();
    const modal = adminPage.getByTestId('role-create-modal');
    await expect(modal).toBeVisible();
    await modal.getByTestId('role-field-name').fill('recruiter-default');
    await modal.getByTestId('role-field-description').fill('hiring loops');
    await modal.getByTestId('role-field-corpus-uris').fill(
      ['wiki://thinking/**', 'output://public/**'].join('\n'),
    );
    await modal.getByTestId('role-create-submit').click();
    await expect(modal).not.toBeVisible({ timeout: 5_000 });
    const created = adminPage.getByTestId('role-row-recruiter-default');
    await expect(created).toBeVisible();
    await expect(created.getByTestId('role-meta-corpus')).toContainText('2 URIs');
  });

  test('delete a non-builtin role', async ({ adminPage }) => {
    await openRoles(adminPage);
    // role created in prior test inside same describe block
    const row = adminPage.getByTestId('role-row-recruiter-default');
    await row.getByTestId('role-delete-recruiter-default').click();
    await expect(row).toHaveCount(0, { timeout: 5_000 });
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

async function openRoles(page: Page): Promise<void> {
  await gotoAdminSection(page, 'roles');
  await page.waitForURL('**/admin/roles', { timeout: 5_000 });
}
