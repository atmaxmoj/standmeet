// admin-sandbox.spec.ts — #147 admin manages the MCP sandbox. The owner uses the
// /api/admin/sandbox/* surface (owner-authed, not /internal/diag) to see active per-session
// workspaces, set a backend-controlled TTL, and sweep on demand.
// The backend sandboxws.Manager + cron sweep already exist (#148); this adds the
// admin-facing surface + frontend panel.
//
// Red (before implementation): /api/admin/sandbox/* all 404. Green: list/ttl/sweep all work,
// owner-authed.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'sandbox-admin@example.com', password: 'correct-horse-battery-staple',
  handle: 'sandboxadmin', fullName: 'Sandbox Admin',
};

interface Workspace { id: string; mod_time: string; age_secs: number }
interface WorkspaceList { workspaces: Workspace[] }
interface SweepResult { removed: number }

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin sandbox management · #147', () => {
  let request: APIRequestContext;
  let csrf: string;

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    csrf = (await loginAPI(request, OWNER.email, OWNER.password)).csrf;
  });

  test.afterAll(async () => { await request.dispose(); });

  test('owner lists workspaces + sets TTL + runs sweep via owner-authed admin routes',
    async () => {
      const listRes = await request.get(`${BACKEND}/api/admin/sandbox/workspaces`);
      expect(listRes.status(), 'workspaces list 200').toBe(200);
      const list = await listRes.json() as WorkspaceList;
      expect(Array.isArray(list.workspaces), 'workspaces is an array').toBe(true);

      const ttlRes = await request.post(`${BACKEND}/api/admin/sandbox/ttl`, {
        headers: { 'X-Csrftoken': csrf }, data: { seconds: 3600 },
      });
      expect(ttlRes.status(), 'set TTL 200').toBe(200);

      const sweepRes = await request.post(`${BACKEND}/api/admin/sandbox/sweep`, {
        headers: { 'X-Csrftoken': csrf }, data: {},
      });
      expect(sweepRes.status(), 'sweep 200').toBe(200);
      const swept = await sweepRes.json() as SweepResult;
      expect(typeof swept.removed, 'sweep returns removed count').toBe('number');
    });

  // Frontend: the admin system section has a sandbox management panel.
  //
  // **This test used to click a button with nothing to sweep** ("clicking it doesn't
  // explode") — and that is exactly the defect F-E-26 recorded: a button that is always
  // clickable, sometimes doing nothing, teaches "no effect" as normal. The judgment
  // criterion is therefore two-sided: with no workspace it must be disabled **and** the
  // screen must say why; with a workspace it must be clickable.
  test('没有 workspace 时 sweep 是禁用的,而且屏幕上说得出为什么',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'system');
      await page.waitForURL('**/admin/system', { timeout: 5_000 });
      const panel = page.getByTestId('sandbox-panel');
      await expect(panel).toBeVisible();
      await expect(panel).toContainText(/mcp sandbox/i);
      // First confirm there really are none right now — otherwise the assertion below
      // would be checking something else.
      const list = await request.get(`${BACKEND}/api/admin/sandbox/workspaces`);
      const { workspaces } = await list.json() as WorkspaceList;
      expect(workspaces.length, 'precondition: 这一刻没有工作区').toBe(0);

      await expect(
        page.getByTestId('sandbox-sweep'),
        '没有东西可扫的时候，这颗按钮不该看起来能做事',
      ).toBeDisabled();
      // The reason must be **on screen**, not only in a title attribute — a disabled
      // button's hover may not even fire.
      await expect(page.getByTestId('sandbox-empty')).toBeVisible();
      await expect(page.getByTestId('sandbox-empty')).toContainText(/no workspaces/i);
    });
});
