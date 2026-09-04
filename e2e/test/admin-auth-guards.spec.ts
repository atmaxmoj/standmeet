// admin-auth-guards.spec.ts —— regression for the two defense layers of /api/admin/*.
//
// User stories:
//   1. An attacker hits /api/admin/me directly without a cookie → must be 401, must not leak owner data.
//   2. The owner's browser is tricked to evil.com, and evil form-submits a POST to /api/admin/codes
//      without the X-Csrftoken header (document.cookie can't read the csrf) → must be 403.
//
// Fully API-driven —— this doesn't need UI, but it's still e2e (real server, real db).

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
      // Log in to get the cookie, but deliberately omit X-Csrftoken.
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
