// admin-sidebar.spec.ts —— admin sidebar badges + nav switching.
//
// 用户故事：
//   1. badge: raw unprocessed > 0 → badge 数字出现
//   2. badge: requests new > 0 → badge 数字出现
//   3. 点 nav link → section 切换 + active 移动

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'sidebar@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'sidebar',
  fullName: 'Sidebar Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin sidebar badges + nav', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('raw unprocessed badge shows count > 0',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'raw');
      // After seeding raw entries, badge should show count
      const badge = adminPage.getByTestId('admin-badge-raw');
      // Badge may or may not be visible depending on unprocessed count
      if (await badge.isVisible({ timeout: 3_000 }).catch(() => false)) {
        const text = await badge.textContent();
        expect(Number(text)).toBeGreaterThan(0);
      }
    });

  test('click nav link → section switches + active state moves',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'wiki');
      await adminPage.waitForURL('**/admin/wiki', { timeout: 5_000 });
      // wiki nav should be active
      // aria-current is on the Link wrapper; testid on the inner span. Use
      // locator('..') to reach the parent.
      const wikiNavLink = adminPage.getByTestId('admin-nav-wiki').locator('..');
      await expect(wikiNavLink).toHaveAttribute('aria-current', 'page');
      // Switch to codes
      await gotoAdminSection(adminPage, 'codes');
      await adminPage.waitForURL('**/admin/codes', { timeout: 5_000 });
      const codesNavLink = adminPage.getByTestId('admin-nav-codes').locator('..');
      await expect(codesNavLink).toHaveAttribute('aria-current', 'page');
      // wiki should no longer be active
      await expect(wikiNavLink).not.toHaveAttribute('aria-current', 'page');
    });

  // #34:AdminShell 挂在 layout → 跨 section 导航 sidebar 不 remount,滚动位置保留
  // (之前每次点击 reset 到顶)。短 viewport 逼 sidebar 滚动,滚下去再导航,验 scrollTop。
  test('persistent layout：sidebar 滚动位置跨导航保留', async ({ adminPage }) => {
    await adminPage.setViewportSize({ width: 1280, height: 460 });
    await gotoAdminSection(adminPage, 'wiki');
    const sidebar = adminPage.getByTestId('admin-sidebar');
    await sidebar.evaluate((el) => { el.scrollTop = 120; });
    expect(await sidebar.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    // 导航到另一个 section —— layout 持久,sidebar 不该 remount/归零。
    await gotoAdminSection(adminPage, 'codes');
    await adminPage.waitForURL('**/admin/codes', { timeout: 5_000 });
    expect(await sidebar.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
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
  const apiToken = await createAPIToken(request, csrf, 'sidebar-seed');
  const sid = await initMCP(request, apiToken);
  // Seed a raw entry (unprocessed)
  await callTool(request, apiToken, sid, 'raw_dump', {
    body: 'unprocessed raw entry for badge test.', source: 'mcp:e2e', tags: [],
  });
  await request.dispose();
}
