// drafts-composer.spec.ts —— /admin/drafts → click "open composer" 进 ResumeComposer
// 全屏分屏 editor。owner 编辑 6 panel + 右侧预览实时更新 + send confirm 模态。
//
// data 仍 mock fixture（admin REST list endpoint 待补），但 UI 行为完整。

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.describe.serial('admin /drafts · ResumeComposer split-pane editor', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('open composer → 6 panel rail + send confirm modal',
    async ({ adminPage }) => {
      await openDrafts(adminPage);
      // mock fixture 第一条 draft id = 'd-1'
      await adminPage.getByTestId('draft-open-d-1').click();
      await expect(adminPage.getByTestId('resume-composer')).toBeVisible();

      // 6 panel nav rail
      for (const id of ['header', 'summary', 'skills', 'experience', 'education', 'cover']) {
        await expect(adminPage.getByTestId(`composer-panel-${id}`)).toBeVisible();
      }
      // header panel 默认 open，company 字段可见
      await expect(adminPage.getByTestId('composer-company')).toBeVisible();

      // 切 summary panel
      await adminPage.getByTestId('composer-panel-summary').click();
      await expect(adminPage.getByTestId('composer-summary')).toBeVisible();

      // send → confirm modal
      await adminPage.getByTestId('composer-send').click();
      await expect(adminPage.getByTestId('composer-confirm-send')).toBeVisible();

      // confirm modal 取消（不点 send 防真 commit）
      await adminPage.getByRole('button', { name: /keep editing/i }).click();
      await expect(adminPage.getByTestId('resume-composer')).toBeVisible();

      // back to drafts list
      await adminPage.getByTestId('composer-back').click();
      await expect(adminPage.getByTestId('resume-composer')).toBeHidden();
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await loginAPI(request, OWNER.email, OWNER.password);
  await request.dispose();
}

async function openDrafts(page: Page): Promise<void> {
  await gotoAdminSection(page, 'drafts');
  await page.waitForURL('**/admin/drafts');
}
