// admin-sidebar.spec.ts —— admin sidebar badges + nav switching.
//
// User story:
//   1. badge: raw unprocessed > 0 → the badge number appears
//   2. badge: requests new > 0 → the badge number appears
//   3. click a nav link → section switches + active moves

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
      // The raw badge now counts the WHOLE inbox via the real COUNT(*) growth endpoint
      // (F-L-4), not the page-limited /corpus/raw list. Assert the badge's real source.
      const rawLoaded = adminPage.waitForResponse(
        (r) => r.url().includes('/api/admin/stats/growth') && r.request().method() === 'GET',
        { timeout: 15_000 });
      const reqLoaded = adminPage.waitForResponse(
        (r) => r.url().includes('/api/admin/access-requests'), { timeout: 15_000 });
      await adminPage.reload(); // re-fires the badge fan-out on a fresh document
      const [rawRes, reqRes] = await Promise.all([rawLoaded, reqLoaded]);
      expect(rawRes.status(), 'growth (badge count source) must 200').toBe(200);
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

  // UX-27 —— the footer's two lines are something the owner sees on every admin page, and
  // neither line is actually about this specific machine: `instance · standmeet` is an i18n
  // constant (every self-hosted instance writes the same thing, so it tells you nothing),
  // and the dash in `uptime · —` is a JSX literal. At the same moment, /admin/system already
  // has a real uptime — the value was already computed, it just was never wired to here.
  // Asserts two things: the footer names this machine, and it reads the same value as the
  // system page.
  test('sidebar footer reports THIS instance and a real uptime (UX-27)',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'dashboard');
      await expect(
        page.getByTestId('sidebar-instance'),
        '页脚的 instance 必须是这台机器的 handle,不是产品名',
      ).toHaveText(OWNER.handle);
      const footerUptime = page.getByTestId('sidebar-uptime');
      await expect(footerUptime, 'uptime 必须是个真时长,不是占位横杠').toHaveText(/^\d+[hms]/);
      // Same system-info: both places read the same store, so the literal text must match
      // character for character. Asserting only "both look like a duration" isn't enough —
      // that would also pass if each side computed its own independent value.
      const footerText = (await footerUptime.innerText()).trim();
      await gotoAdminSection(page, 'system');
      await expect(page.getByTestId('system-uptime')).toHaveText(footerText);
    });

  // #34: AdminShell mounts at the layout level → the sidebar doesn't remount when
  // navigating across sections, so its scroll position is preserved (it used to reset to
  // the top on every click). A short viewport forces the sidebar to scroll; scroll down,
  // navigate, then check scrollTop.
  test('persistent layout：sidebar 滚动位置跨导航保留', async ({ adminPage }) => {
    await adminPage.setViewportSize({ width: 1280, height: 460 });
    await gotoAdminSection(adminPage, 'wiki');
    const sidebar = adminPage.getByTestId('admin-sidebar');
    await sidebar.evaluate((el) => { el.scrollTop = 120; });
    expect(await sidebar.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    // Navigate to another section — the layout persists, so the sidebar shouldn't remount/reset to zero.
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
  await callTool(request, apiToken, sid, 'corpus.create', {
    genre: 'raw', body: 'unprocessed raw entry for badge test.', source: 'mcp:e2e', tags: [],
  });
  await request.dispose();
}
