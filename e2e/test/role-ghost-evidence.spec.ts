// role-ghost-evidence.spec.ts —— F-A-10 owner 开关「内容型引导 ghost 需带语料证据」的后台 UI,
// role 端 + code-override 端往返。
//
// 守两件事:
//  1. role 卡上的开关持久化(开 → reload → 仍开);
//  2. **零化回归**:开了之后再存 dock(兄弟保存),require_ghost_evidence 不能被清零 —— 这条在
//     修复前(dockPayload 不带 require_ghost_evidence)会 RED。
//  3. code override 3 态(inherit/on/off)往返:显式覆盖持久化,inherit 清覆盖回落 role。

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
      // 前置:上一个 test 已把开关打开并持久化。这里存 dock(一个兄弟全量 PUT)。
      await expect(row.getByTestId('role-ghost-evidence-toggle')).toBeChecked();
      await row.getByTestId('role-dock-save').click();
      await expectSuccessToast(adminPage, /dock/i);
      await adminPage.reload();
      await openRoles(adminPage);
      // dock 存完 ghost 规则必须还在(修复前 dockPayload 不回传 → 这里 RED)。
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
      // 回 inherit:清覆盖,重新继承 role。
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
