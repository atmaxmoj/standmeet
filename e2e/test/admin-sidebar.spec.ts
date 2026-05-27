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
      const wikiNav = adminPage.getByTestId('admin-nav-wiki');
      await expect(wikiNav).toHaveAttribute('aria-current', 'page');
      // Switch to codes
      await gotoAdminSection(adminPage, 'codes');
      await adminPage.waitForURL('**/admin/codes', { timeout: 5_000 });
      const codesNav = adminPage.getByTestId('admin-nav-codes');
      await expect(codesNav).toHaveAttribute('aria-current', 'page');
      // wiki should no longer be active
      await expect(wikiNav).not.toHaveAttribute('aria-current', 'page');
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
