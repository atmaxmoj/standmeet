// admin-sandbox.spec.ts —— #147 admin 管理 MCP 沙箱。owner 经 /api/admin/sandbox/* 面
// (owner-authed,不是 /internal/diag)看活跃 per-session 工作区、设后端可控 TTL、按需清扫。
// 后端 sandboxws.Manager + cron sweep 已在(#148);这里补 admin-facing 面 + 前端面板。
//
// 红(实现前):/api/admin/sandbox/* 全 404。绿:list/ttl/sweep 都通,owner-authed。

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

  // 前端:admin system section 有 sandbox 管理面板。
  //
  // **这条以前点的是一颗没有东西可扫的按钮**（「点了不炸」）——而那正是 F-E-26 记下的缺陷：
  // 一颗永远可点、有时什么都不发生的按钮，会把「没生效」教成正常。判据因此改成两面：
  // 没有 workspace 时它禁用**而且**屏幕上说得出为什么；有 workspace 时它可点。
  test('没有 workspace 时 sweep 是禁用的,而且屏幕上说得出为什么',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'system');
      await page.waitForURL('**/admin/system', { timeout: 5_000 });
      const panel = page.getByTestId('sandbox-panel');
      await expect(panel).toBeVisible();
      await expect(panel).toContainText(/mcp sandbox/i);
      // 先确认这一刻真的一个都没有 —— 否则下面断的是别的东西。
      const list = await request.get(`${BACKEND}/api/admin/sandbox/workspaces`);
      const { workspaces } = await list.json() as WorkspaceList;
      expect(workspaces.length, 'precondition: 这一刻没有工作区').toBe(0);

      await expect(
        page.getByTestId('sandbox-sweep'),
        '没有东西可扫的时候，这颗按钮不该看起来能做事',
      ).toBeDisabled();
      // 理由要在**屏幕上**，不是只挂在 title 里 —— 禁用的按钮 hover 都未必触发。
      await expect(page.getByTestId('sandbox-empty')).toBeVisible();
      await expect(page.getByTestId('sandbox-empty')).toContainText(/no workspaces/i);
    });
});
