// iam-role-fk-restrict.spec.ts —— DB FK / referential-integrity rejection paths:
//   - DELETE role fails when it's still referenced by an active code (FK ON DELETE RESTRICT)
//   - POST code with a non-existent assumed_role_id → backend errors (FK violation)
//
// The backend schema falls back on RESTRICT; the usecase doesn't pre-validate
// because letting the constraint catch it is more reliably race-free.
//
// admin REST needs cookie+csrf same-origin; each test logs in itself.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createRole } from '@/fixtures/roles';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'rolefk@example.com', password: 'correct-horse-battery-staple',
  handle: 'rolefk', fullName: 'Role FK Owner',
};

test.beforeAll(async ({ playwright }) => {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
});

async function authedRequest(
  newCtx: () => Promise<APIRequestContext>,
): Promise<{ request: APIRequestContext; csrf: string }> {
  const request = await newCtx();
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  return { request, csrf };
}

test.describe('A.3-IAM role FK restrict + bogus role_id at code-create', () => {
  test('cannot delete a role while an active code references it',
    async ({ playwright }) => {
      const { request, csrf } = await authedRequest(() => playwright.request.newContext());
      const role = await createRole(request, csrf, { name: 'in-use-role' });
      await createCode(request, csrf, {
        code: 'IN-USE-1', label: 'in-use', assumed_role_id: role.id,
      });
      const res = await request.delete(`${BACKEND}/api/admin/roles/${role.id}`, {
        headers: { 'X-Csrftoken': csrf },
      });
      // FK RESTRICT → server-side error envelope (500 with server_error)
      // because we don't pre-check in usecase. Any 4xx/5xx is acceptable;
      // the key is delete must not succeed.
      expect(res.status()).toBeGreaterThanOrEqual(400);
      await request.dispose();
    });

  test('cannot issue a code with a non-existent role_id',
    async ({ playwright }) => {
      const { request, csrf } = await authedRequest(() => playwright.request.newContext());
      const bogus = '00000000-0000-0000-0000-000000000000';
      const res = await request.post(`${BACKEND}/api/admin/codes`, {
        headers: { 'X-Csrftoken': csrf },
        data: {
          code: 'BOGUS-ROLE-1',
          label: 'bogus role spec',
          purpose: '',
          ghosts: [],
          max_members: null,
          max_turns_per_session: null,
          max_bookings: null,
          assumed_role_id: bogus,
        },
      });
      expect(res.status()).toBeGreaterThanOrEqual(400);
      await request.dispose();
    });
});
