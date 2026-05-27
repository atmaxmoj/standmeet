// admin-auth-guards.spec.ts —— /api/admin/* 的两层防御回归。
//
// 用户故事：
//   1. 攻击者直接打 /api/admin/me 没带 cookie → 必须 401，不能泄漏 owner 数据。
//   2. owner 浏览器被骗去 evil.com，evil 用 form 提交 POST 到 /api/admin/codes
//      没拿到 X-Csrftoken header（document.cookie 拿不到 csrf 用），必须 403。
//
// 全 API 驱动 —— 这条不需要 UI 介入，但属于 e2e（真实 server, 真实 db）。

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.describe('admin auth + CSRF guards', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('unauthenticated GET /admin/me → 401', async ({ playwright }) => {
    // fresh context = no cookies
    const ctx = await playwright.request.newContext();
    const res = await ctx.get(`${BACKEND}/api/admin/me`);
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test('authenticated POST without X-Csrftoken header → 403',
    async ({ playwright }) => {
      const ctx = await playwright.request.newContext();
      // 走 login 拿到 cookie，但故意不传 X-Csrftoken。
      await loginAPI(ctx, OWNER.email, OWNER.password);
      const res = await ctx.post(`${BACKEND}/api/admin/codes/`, {
        data: { code: 'CSRF-TEST', label: 'should fail', purpose: 'csrf check' },
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status()).toBe(403);
      const body = await res.json() as { error?: { code?: string } };
      expect(body.error?.code).toBe('csrf_invalid');
      await ctx.dispose();
    });
});
