// admin-sandbox.spec.ts —— #147 admin 管理 MCP 沙箱。owner 经 /api/admin/sandbox/* 面
// (owner-authed,不是 /internal/diag)看活跃 per-session 工作区、设后端可控 TTL、按需清扫。
// 后端 sandboxws.Manager + cron sweep 已在(#148);这里补 admin-facing 面 + 前端面板。
//
// 红(实现前):/api/admin/sandbox/* 全 404。绿:list/ttl/sweep 都通,owner-authed。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'sandbox-admin@example.com', password: 'correct-horse-battery-staple',
  handle: 'sandboxadmin', fullName: 'Sandbox Admin',
};

interface Workspace { id: string; mod_time: string; age_secs: number }
interface WorkspaceList { workspaces: Workspace[] }
interface SweepResult { removed: number }

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
});
