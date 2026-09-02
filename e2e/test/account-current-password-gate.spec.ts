// account-current-password-gate.spec.ts -- the "verify current password" gate in
// front of email/password change.
//
// Defect (audited 2026-08-30): `verifyCurrentPassword` is the entire reason
// change_email / change_password exist, yet before this spec, no test case ever
// exercised the "wrong password" path.
// Replace it with `return nil` and the whole suite still stays green -- a gate
// that has never gone red is not a gate.
//
// This is also the mirror image of "coverage that is all failure paths": that
// lesson was about testing only error paths and never the success path;
// here it is the opposite -- only the success path was tested, and the device
// meant to reject was never once asked to reject.
//
// Judgment criterion (assert the outcome): after a rejection, **nothing changed**.
// Asserting only "an error toast appeared" is not enough --
// "reported an error but changed it anyway" also produces an error toast, and
// that is the worst kind of failure.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';
import { expectErrorToast } from '@/fixtures/toast';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const WRONG = 'this-is-not-the-password';

const OWNER = {
  email: 'gated@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'gated',
  fullName: 'Gary Gated',
};
const TARGET_EMAIL = 'gated+moved@example.com';
const TARGET_PASSWORD = 'attacker-chosen-98765';

async function loginStatus(
  request: APIRequestContext, email: string, password: string,
): Promise<number> {
  const res = await request.post(`${BACKEND}/api/admin/login`, {
    data: { email, password },
  });
  return res.status();
}

async function currentEmail(request: APIRequestContext, csrf: string): Promise<string> {
  const res = await request.get(`${BACKEND}/api/admin/me`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (res.status() !== 200) throw new Error(`me: ${res.status()}`);
  return (await res.json() as { owner: { email: string } }).owner.email;
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('account · the current-password gate refuses, and nothing moves', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('wrong current password → email refused, and the email does not move',
    async ({ adminPage: page, playwright }) => {
      await gotoAdminSection(page, 'account');
      await page.waitForURL('**/admin/account', { timeout: 5_000 });

      await page.getByTestId('account-email-current-password').fill(WRONG);
      await page.getByTestId('account-email-new').fill(TARGET_EMAIL);
      await page.getByTestId('account-email-confirm').fill(TARGET_EMAIL);
      await page.getByTestId('account-email-save').click();

      await expectErrorToast(page, /password/i);

      const request = await playwright.request.newContext();
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      expect(await currentEmail(request, csrf)).toBe(OWNER.email);
      // That address must not become an identity -- it should not even be "pending".
      expect(await loginStatus(request, TARGET_EMAIL, OWNER.password)).toBe(401);
      await request.dispose();
    });

  test('wrong current password → password refused, and the old password still works',
    async ({ adminPage: page, playwright }) => {
      await gotoAdminSection(page, 'account');
      await page.waitForURL('**/admin/account', { timeout: 5_000 });

      await page.getByTestId('account-password-current').fill(WRONG);
      await page.getByTestId('account-password-new').fill(TARGET_PASSWORD);
      await page.getByTestId('account-password-confirm').fill(TARGET_PASSWORD);
      await page.getByTestId('account-password-save').click();

      await expectErrorToast(page, /password/i);

      const request = await playwright.request.newContext();
      // Login still works with the old password = the password was really not changed.
      expect(await loginStatus(request, OWNER.email, OWNER.password)).toBe(200);
      // The would-be new password cannot log in.
      expect(await loginStatus(request, OWNER.email, TARGET_PASSWORD)).toBe(401);
      await request.dispose();
    });
});
