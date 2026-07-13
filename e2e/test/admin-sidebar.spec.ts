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

  // Regression guard for the sidebar-badge fan-out (F-C-1). The old code was
  // triple-broken and the badge feature was silently dead:
  //   1. wrong paths — `/corpus/raw/` (proxy strips the slash → 200 bare array)
  //      and `/requests/` (backend serves `/access-requests` → 404);
  //   2. an `{items}` object schema against a BARE-array response → the raw
  //      fetch threw a ZodError (an *unhandled* rejection — invisible to
  //      page.on('console'), which is why the earlier lenient test passed);
  //   3. the backend `rawListItem` never carried a `status`, so the
  //      `status === 'unprocessed'` filter was always 0.
  // This asserts the *observable outcome* — both endpoints 200 and the raw
  // badge renders the seeded count — so any of the three regressions is RED.
  // initOwner seeds exactly one unpromoted raw ⇒ the badge must be > 0.
  test('sidebar badges load from the real endpoints and render (F-C-1)',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'raw');
      const rawLoaded = adminPage.waitForResponse(
        (r) => r.url().includes('/api/admin/corpus/raw') && r.request().method() === 'GET',
        { timeout: 15_000 });
      const reqLoaded = adminPage.waitForResponse(
        (r) => r.url().includes('/api/admin/access-requests'), { timeout: 15_000 });
      await adminPage.reload(); // re-fires the badge fan-out on a fresh document
      const [rawRes, reqRes] = await Promise.all([rawLoaded, reqLoaded]);
      expect(rawRes.status(), 'raw list path must 200').toBe(200);
      expect(reqRes.status(), 'access-requests path must 200, not 404').toBe(200);
      const badge = adminPage.getByTestId('badge-raw');
      await expect(badge).toBeVisible({ timeout: 10_000 });
      expect(Number(await badge.textContent())).toBeGreaterThan(0);
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
