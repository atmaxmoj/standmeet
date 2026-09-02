// account-recovery-row-tells-the-truth.spec.ts -- the button works, but the copy next to
// it says "not built yet".
//
// Defect (found 2026-08-31 during an audit coverage sweep): `lib/admin/account-form.ts`'s
// `recoveryRowView` returns, when the mail connector is already verified,
//
//     note: 'Generates a recovery phrase emailed to you (generation not built yet).'
//
// but the feature **is finished** -- `routes/admin/account.go:33` mounts
// `POST /account/recovery`, `routes/admin/claim.go:74` mounts `POST /recover`,
// `recovery-phrase.spec.ts` runs and is not skipped, and `AccountSection.tsx:98`'s button
// really does POST out and toast success.
//
// This belongs to the [[names-that-lie]] family: copy shown to the owner that asserts
// something opposite to what the product actually does. The cost isn't "ugly copy" --
// it's that the owner **won't use a feature that could save them**. And this feature is
// exactly the only way back after a typo'd email, the other half of the pending-email story.
//
// The criterion is a pair: first prove it **really can generate and send** (the positive
// control), then assert the copy isn't lying. Asserting only the copy would leave this
// test green even the day the feature actually breaks.

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { clearMailpit, configureMailConnector, waitForMailTo } from '@/fixtures/mail';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'truthful@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'truthful',
  fullName: 'Tess Truthful',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('account · the recovery row describes what the button actually does', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await configureMailConnector(request, OWNER.email, OWNER.password);
    await clearMailpit(request);
    await request.dispose();
  });

  // -- positive control: it actually works --------------------------------
  test('with a verified mail connector, generate actually sends a phrase to the owner',
    async ({ adminPage: page, playwright }) => {
      await gotoAdminSection(page, 'account');
      await page.waitForURL('**/admin/account', { timeout: 5_000 });

      const btn = page.getByTestId('recovery-generate');
      await expect(btn).toBeEnabled();
      await btn.click();

      // Verify the receipt against the external inbox, not the product's own
      // "sent" claim ([[receipt-check-belongs-next-to-the-action]]).
      const request = await playwright.request.newContext();
      const body = await waitForMailTo(request, OWNER.email);
      expect(body.length).toBeGreaterThan(0);
      await request.dispose();
    });

  // -- with the positive control in place, the copy half of the test matters --
  test('the row does not tell the owner the feature is unbuilt',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'account');
      await page.waitForURL('**/admin/account', { timeout: 5_000 });
      // The copy lives in the InfoDot tooltip and the button's title attribute, not in
      // its text content -- read the attribute.
      // ([[negated-assertion-passes-while-absent]]: pull the value out first, then assert
      //   on it, rather than writing .not.toContainText against a possibly-absent element.)
      const note = await page.getByTestId('recovery-generate').getAttribute('title');
      expect(note, 'recovery 行没有说明文字').not.toBeNull();
      // Copy that says the opposite would stop the owner from using the one feature
      // that could save them.
      expect(note!).not.toMatch(/not built|coming soon|not yet implemented/i);
      // And it must actually say what the thing **is**, otherwise removing the lie
      // just leaves a blank.
      expect(note!).toMatch(/recovery phrase|emails it to you/i);
      await expect(page.getByTestId('recovery-row')).toContainText(/recovery phrase/i);
    });

  // -- without a mail connector, the copy still has to be true --------------
  test('without a mail connector the row explains the gate, and the button is off',
    async ({ adminPage: page, playwright }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      // Remove the mail connector: the disabled-state copy should say "missing SMTP",
      // not also say "not built".
      await request.delete(`${process.env['BACKEND_URL'] ?? 'http://localhost:8000'}` +
        `/api/admin/connectors/mail-sender/credentials`, { headers: { 'X-Csrftoken': csrf } });
      await request.dispose();

      await gotoAdminSection(page, 'account');
      await page.waitForURL('**/admin/account', { timeout: 5_000 });
      const note = await page.getByTestId('recovery-generate').getAttribute('title');
      expect(note, '灰态也得有说明').not.toBeNull();
      // The disabled-state copy should say "missing SMTP", not also say "not built".
      expect(note!).toMatch(/verif|email|smtp/i);
      expect(note!).not.toMatch(/not built|coming soon/i);
      await expect(page.getByTestId('recovery-generate')).toBeDisabled();
    });
});
