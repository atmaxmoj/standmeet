// admin-prompts.spec.ts —— /admin/prompts UI-driven CRUD。
//
// 用户故事：
//   1. claim 后 vanilla prompt 已种入，list 包含 [system] pill
//   2. owner 创建 prompt → 出现在 list，body preview 渲染
//   3. vanilla 没 delete button；自建 prompt 可删

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'prompts-admin@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'promptsadmin',
  fullName: 'Prompts Admin Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('admin prompts', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('vanilla prompt seeded on claim is listed with [system] pill', async ({ adminPage }) => {
    await openPrompts(adminPage);
    const vanilla = adminPage.getByTestId('prompt-row-vanilla');
    await expect(vanilla).toBeVisible();
    await expect(vanilla.getByTestId('prompt-system-pill')).toBeVisible();
  });

  test('vanilla prompt has no delete button', async ({ adminPage }) => {
    await openPrompts(adminPage);
    const vanilla = adminPage.getByTestId('prompt-row-vanilla');
    await expect(vanilla.getByTestId('prompt-delete-vanilla')).toHaveCount(0);
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
