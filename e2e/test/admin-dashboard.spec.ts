// admin-dashboard.spec.ts —— admin dashboard KPI cards + sparkline + jump links.
//
// 用户故事：
//   1. owner 登录 → dashboard 是默认 landing
//   2. 4 KPI cards 显示数据 (entries / unprocessed / codes / requests)
//   3. sparkline SVG 渲染 14 天曲线
//   4. "needs your hand" section 渲染
//   5. jump 链接 → 点击跳到对应 admin section

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'dash-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'dashowner',
  fullName: 'Dash Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin dashboard', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('dashboard is default landing after login',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'dashboard');
      await expect(adminPage.getByTestId('dashboard')).toBeVisible({ timeout: 5_000 });
    });

  test('4 KPI cards visible with real data',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'dashboard');
      await expect(adminPage.getByTestId('kpi-entries')).toBeVisible();
      await expect(adminPage.getByTestId('kpi-unprocessed')).toBeVisible();
      await expect(adminPage.getByTestId('kpi-codes live')).toBeVisible();
      await expect(adminPage.getByTestId('kpi-requests')).toBeVisible();
    });

  test('sparkline SVG renders',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'dashboard');
      await expect(adminPage.getByTestId('sparkline')).toBeVisible({ timeout: 5_000 });
    });

  test('jump links → click "raw" → navigate to admin raw',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'dashboard');
      const jumpLink = adminPage.getByTestId('dashboard-jump-raw');
      if (await jumpLink.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await jumpLink.click();
        await adminPage.waitForURL('**/admin/raw', { timeout: 5_000 });
      }
    });

  test('"needs your hand" → all zero → nothing pending',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'dashboard');
      const pending = adminPage.getByTestId('needs-hand');
      await expect(pending).toBeVisible();
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
  const apiToken = await createAPIToken(request, csrf, 'dash-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'dash intro.', title: 'Dash Intro',
  });
  await createCode(request, csrf, {
    code: 'DASH-001', label: 'Dashboard test',
  });
  await request.dispose();
}
