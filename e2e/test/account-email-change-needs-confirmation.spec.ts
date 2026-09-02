// account-email-change-needs-confirmation.spec.ts — the owner changing their email must not
// lock themselves out.
//
// Defect (found manually 2026-08-30): the `owners.email` column is both the **login identity**
// and the **recovery channel** (`usecase/recovery.go`'s `To:` reads it directly). Changing the
// email moved both atomically, before any step proved the new address could receive mail. So a
// single typo removed both the key and the spare key at once — and since the session is keyed by
// ownerID, nothing feels wrong until the session expires.
//
// Judgment criterion (assert the good outcome, not "no red text"): once the mail connector is
// configured, changing the email must **only produce a confirmation message**; identity **must
// not move yet** — the old email must still be able to log in until confirmed. That is the real
// meaning of "not locked out". Asserting "a success toast appeared" is not enough: that is a
// non-unique signal — the product would show success even if it had swapped identity outright.
//
// The receipt must be checked next to the action: read the confirmation mail from mailpit (an
// external inbox), never trust the product's own "sent" claim.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import {
  clearMailpit, configureMailConnector, confirmLinkIn, followMailedLink, waitForMailTo,
} from '@/fixtures/mail';
import { gotoAdminSection } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'confirmer@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'confirmer',
  fullName: 'Connie Confirmer',
};
const NEW_EMAIL = 'confirmer+moved@example.com';

// loginStatus — only the status code matters. login() throws on failure, and "failure" itself
// is exactly what this needs to observe.
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
test.describe('account · a new email must prove it is reachable before it becomes the login', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await configureMailConnector(request, OWNER.email, OWNER.password);
    await clearMailpit(request);
    await request.dispose();
  });

  test('with a verified mail connector: the change is pending until the new address confirms it',
    async ({ adminPage: page, playwright }) => {
      await gotoAdminSection(page, 'account');
      await page.waitForURL('**/admin/account', { timeout: 5_000 });

      // Before acting: this blurb's copy must match its actual behavior. Before the
      // confirmation flow was added it said "Changing it moves both" — the mechanism
      // changed but the copy didn't, so it now lies to the owner, and that lie never
      // turns any test red ([[names-that-lie]]). Only a real-prod eyeball check would
      // have caught it.
      const blurb = await page.getByTestId('account-email-block').innerText();
      expect(blurb, '这块说明还在承诺"改了就生效"，而实际要等确认').toContain('confirm');
      expect(blurb).not.toContain('moves both');

      await page.getByTestId('account-email-current-password').fill(OWNER.password);
      await page.getByTestId('account-email-new').fill(NEW_EMAIL);
      await page.getByTestId('account-email-confirm').fill(NEW_EMAIL);
      await page.getByTestId('account-email-save').click();

      // The UI must say clearly "a mail was sent", not "it's done" — the sentence the
      // owner reads decides what they do next.
      await expect(page.getByTestId('account-email-pending')).toContainText(NEW_EMAIL);

      const request = await playwright.request.newContext();

      // ① Identity has not moved: the old email **still** logs in. This is the actual
      // meaning of "not locked out".
      expect(await loginStatus(request, OWNER.email, OWNER.password)).toBe(200);
      // ② The new email is not the identity until confirmed.
      expect(await loginStatus(request, NEW_EMAIL, OWNER.password)).toBe(401);
      // ③ /me still reads the old email.
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      expect(await currentEmail(request, csrf)).toBe(OWNER.email);

      // ④ Check the receipt via an external inbox: the confirmation mail went to the
      // **new** address (not the old one).
      const body = await waitForMailTo(request, NEW_EMAIL);
      const link = confirmLinkIn(body, 'confirm-email');

      // ⑤ Take the real path — open the link from the mail in a browser, don't hit the
      // API directly.
      //    "test covers capability, not face": hitting only the API would still pass
      //    green even if the link page didn't exist at all.
      await followMailedLink(page, link);
      await expect(page.getByTestId('email-confirmed')).toBeVisible({ timeout: 10_000 });

      // ⑥ Only now does identity move: the new email logs in, the old one is dead.
      expect(await loginStatus(request, NEW_EMAIL, OWNER.password)).toBe(200);
      expect(await loginStatus(request, OWNER.email, OWNER.password)).toBe(401);
      const after = await login(request, NEW_EMAIL, OWNER.password);
      expect(await currentEmail(request, after.csrf)).toBe(NEW_EMAIL);

      // ⑦ The confirmation link is single-use — a replayable confirmation link would
      // leave identity hanging off a stale email.
      await followMailedLink(page, link);
      await expect(page.getByTestId('email-confirmed')).toBeHidden();

      await request.dispose();
    });
});
