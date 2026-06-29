// connector-add-modal.spec.ts —— /admin/connectors 的 "+ add" 模态：
// 18-entry CONNECTOR_REGISTRY 按 5 类 tab 过滤 + dynamic config form。
//
// 业务故事：owner 想接 Notion / Calendar / S3 任意新 connector → 点
// "+ add connector" → 选 category tab → 点 catalog 卡片 → fields[] 自动
// 渲表单 → connect。GCal booking 之后 follows this exact path —— append
// 一条 entry 进 registry，UI 自动收录。

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

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin /connectors · add modal + dynamic config form', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('"+ add connector" → modal → catalog → category tab → connect',
    async ({ adminPage }) => {
      await openConnectors(adminPage);
      await adminPage.getByTestId('connector-add-open').click();
      // catalog 默认在 comms 分类，第一条是 email
      await expect(adminPage.getByTestId('connector-card-email')).toBeVisible();
      // 切到 storage 类
      await adminPage.getByRole('button', { name: /storage & backup/i }).click();
      await expect(adminPage.getByTestId('connector-card-s3')).toBeVisible();
      // 点开 s3 config form
      await adminPage.getByTestId('connector-card-s3').click();
      // fields 动态渲：endpoint / bucket / access_key (secret) / secret_key (secret)
      await adminPage.getByTestId('connector-field-endpoint').fill('s3.amazonaws.com');
      await adminPage.getByTestId('connector-field-bucket').fill('my-backup');
      await adminPage.getByTestId('connector-field-access_key').fill('AKIA-fake');
      await adminPage.getByTestId('connector-field-secret_key').fill('secret-fake');
      await adminPage.getByTestId('connector-config-save').click();
      // 模态关闭
      await expect(adminPage.getByTestId('connector-add-open')).toBeVisible({ timeout: 3_000 });
    });

  test('calendar card → normalized assemble view (OpenAPI upload + built-in CalDAV form)',
    async ({ adminPage }) => {
      await openConnectors(adminPage);
      await adminPage.getByTestId('connector-add-open').click();
      // 归一后：calendar 不再是写死的 provider 下拉（legacy 已删），而是装配视图——既能贴
      // OpenAPI spec 装配 per-SaaS，也能填内置 CalDAV 协议的固定表单。
      await adminPage.getByTestId('connector-card-calendar').click();
      await expect(adminPage.getByTestId('connector-spec-input')).toBeVisible();
      await expect(adminPage.getByTestId('connector-field-url')).toBeVisible();
      // 密钥字段遮成 password。
      await expect(adminPage.getByTestId('connector-field-password'))
        .toHaveAttribute('type', 'password');
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

async function openConnectors(page: Page): Promise<void> {
  await gotoAdminSection(page, 'connectors');
  await page.waitForURL('**/admin/connectors');
}
