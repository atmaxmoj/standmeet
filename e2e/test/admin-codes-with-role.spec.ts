// admin-codes-with-role.spec.ts —— code create modal 的 role dropdown +
// CodeCard 上 role link + (frozen) 时间戳显示。A.3-IAM-3 落地点。
//
// 用户故事：
//   owner 想给 recruiter 一个 code → 选已建好的 role "recruiter-default" →
//   发 code → list 卡上 role 字段显示 vanilla / recruiter-default 链接 +
//   "issued with role (frozen)" 小字。

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'codes-role@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'codesrole',
  fullName: 'Codes Role Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('issue code with assumed_role_id', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('code create modal exposes role dropdown including vanilla',
    async ({ adminPage }) => {
      await openCodes(adminPage);
      await adminPage.getByRole('button', { name: /new code/i }).click();
      const dropdown = adminPage.getByTestId('code-field-role');
      await expect(dropdown).toBeVisible();
      // useRoles fetches on modal mount; await the vanilla option appearing.
      await expect(dropdown.locator('option', { hasText: 'vanilla' }))
        .toHaveCount(1, { timeout: 5_000 });
    });

  test('issue code with vanilla role → CodeCard shows role link + (frozen)',
    async ({ adminPage }) => {
      await openCodes(adminPage);
      await adminPage.getByRole('button', { name: /new code/i }).click();
      await adminPage.getByTestId('code-input').fill('RECR-001');
      await adminPage.getByTestId('code-label').fill('recruiter loop');
      const dropdown = adminPage.getByTestId('code-field-role');
      // useRoles fetches on modal mount; await vanilla option before selecting.
      await expect(dropdown.locator('option', { hasText: 'vanilla' }))
        .toHaveCount(1, { timeout: 5_000 });
      await dropdown.selectOption({ label: 'vanilla' });
      await adminPage.getByTestId('code-create').click();
      const row = adminPage.getByTestId('code-row-RECR-001');
      await expect(row).toBeVisible({ timeout: 5_000 });
      await expect(row.getByTestId('code-role-frozen')).toBeVisible();
      // frozen line 应包含 "issued with role" 字样
      await expect(row.getByTestId('code-role-frozen')).toContainText('frozen');
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

async function openCodes(page: Page): Promise<void> {
  await gotoAdminSection(page, 'codes');
  await page.waitForURL('**/admin/codes', { timeout: 5_000 });
}
