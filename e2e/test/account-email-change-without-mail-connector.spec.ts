// account-email-change-without-mail-connector.spec.ts —— what backstops an email change when there's no SMTP.
//
// The confirmation-email path (see account-email-change-needs-confirmation.spec.ts) has a precondition:
// a verified mail connector must exist. When it doesn't, you can't just remove the gate —— that's the
// opposite of "gate granularity removes working action": dropping the protection entirely to keep it usable.
// Without SMTP it degrades into two things:
//
//   1. Enter the new email twice. Changing the password already requires double entry (`account-password-confirm`
//      is right there), yet an equally dangerous action on the same panel doesn't —— that inconsistency is itself a defect.
//   2. State the consequence in full. The current blurb only says "Your login identity.", missing the second half:
//      where the recovery phrase is sent moves too. A sentence that doesn't state the full consequence is about as good as no sentence.
//
// Criteria: when the two entries mismatch, the **email does not change** (asserting an error appeared is not enough —— "errored but also changed" also satisfies that);
// when they match, the identity really moves, and the **old email cannot log in** (proving only the new one can log in doesn't prove whether the identity moved or a second one was added).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'nosmtp@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'nosmtp',
  fullName: 'Nora NoSMTP',
};
const TYPO_EMAIL = 'nosmtp+mvoed@example.com';  // the fat-fingered version
const GOOD_EMAIL = 'nosmtp+moved@example.com';

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
test.describe('account · no mail connector → double entry, and the consequence is stated', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    // Deliberately **do not** configure a mail connector —— this spec tests exactly the no-SMTP half.
    await request.dispose();
  });

  test('the email block says the recovery destination moves too',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'account');
      await page.waitForURL('**/admin/account', { timeout: 5_000 });
      // Before pressing the button the owner must read: this step also moves away the recovery channel.
      await expect(page.getByTestId('account-email-block')).toContainText(/recovery/i);
    });

  test('mismatched confirmation is refused and the email does not move',
    async ({ adminPage: page, playwright }) => {
      await gotoAdminSection(page, 'account');
      await page.waitForURL('**/admin/account', { timeout: 5_000 });

      await page.getByTestId('account-email-current-password').fill(OWNER.password);
      await page.getByTestId('account-email-new').fill(GOOD_EMAIL);
      await page.getByTestId('account-email-confirm').fill(TYPO_EMAIL);

      // The save button must block —— when the two entries mismatch it shouldn't be clickable.
      await expect(page.getByTestId('account-email-save')).toBeDisabled();

      const request = await playwright.request.newContext();
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      expect(await currentEmail(request, csrf)).toBe(OWNER.email);
      await request.dispose();
    });

  test('matching confirmation moves the identity: new email lives, old email dies',
    async ({ adminPage: page, playwright }) => {
      await gotoAdminSection(page, 'account');
      await page.waitForURL('**/admin/account', { timeout: 5_000 });

      await page.getByTestId('account-email-current-password').fill(OWNER.password);
      await page.getByTestId('account-email-new').fill(GOOD_EMAIL);
      await page.getByTestId('account-email-confirm').fill(GOOD_EMAIL);
      await page.getByTestId('account-email-save').click();
      // Wait for the save to **actually complete** before asserting login —— the click is async, and not waiting asserts a fact that hasn't happened yet.
      // And this message must say "changed", not "sent an email": without SMTP it takes the direct-swap path.
      await expect(page.getByTestId('toast-success')).toContainText(/updated to/i);

      const request = await playwright.request.newContext();
      expect(await loginStatus(request, GOOD_EMAIL, OWNER.password)).toBe(200);
      // The identity is **moved**, not duplicated.
      expect(await loginStatus(request, OWNER.email, OWNER.password)).toBe(401);
      await request.dispose();
    });
});
