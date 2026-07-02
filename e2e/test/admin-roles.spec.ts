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

  // 失败反显守护：重名 create 被后端拒(409)时，owner 必须看见 error toast，且 modal 保持开着让人改
  // ——原来 mutation 吞成 false、modal 无论成败都关，失败像成功了一样静默。
  test('duplicate role name → error toast + modal stays open (surfaced, not silent)', async ({ adminPage }) => {
    await openRoles(adminPage);
    await adminPage.getByTestId('role-new').click();
    const modal = adminPage.getByTestId('role-create-modal');
    await expect(modal).toBeVisible();
    // recruiter-default 已在上个 test 建了 → 同名必被拒。
    await modal.getByTestId('role-field-name').fill('recruiter-default');
    await modal.getByTestId('role-field-description').fill('dup');
    await modal.getByTestId('role-field-corpus-uris').fill('wiki://thinking/**');
    await modal.getByTestId('role-create-submit').click();
    await expectErrorToast(adminPage, /already|exist|duplicate|taken|conflict|in use/i);
    await expect(modal, 'modal stays open on failure (not closed as if it saved)').toBeVisible();
    await adminPage.keyboard.press('Escape'); // 收尾，别影响后面的 delete test
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
