// captcha-on-request-flood.spec.ts -- F-G-4: the inbox a human reads note by
// note needs a lock in front of it.
//
// `POST /api/v1/access-requests` is an **unauthenticated write**; its only
// protection is `ratelimit.go`'s 30/min/IP, and `PublicRateGuard` explicitly
// **fails open** on a redis outage. Verified in prod: the same IP sending 34
// notes back to back gets **all 30 of the first ones stored**. 30/min
// sustained is 43,000/day, while the gate copy reads
// *"Read by hand, not a queue."*
//
// The code-redemption path already has a failed-attempt lock + captcha unlock
// (#169 / F-G-3). **The other write endpoint on the same door** has nothing --
// this spec guards that gap: flood past the threshold -> refused -> a human
// check appears -> solving it still lets the note through (not locking a
// person out forever, but making a script pay a cost).
//
// Run via `make test-captcha` (Cloudflare's always-pass test key).

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { skipUnlessCaptchaOn } from '@/fixtures/captcha';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { configureMailConnector } from '@/fixtures/mail';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'request-flood@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'requestflood',
  fullName: 'Request Flood Owner',
};

// FLOOD -- the count needed to exceed the threshold. The threshold is set at
// a scale a real human would not reach within 15 minutes.
const FLOOD = 6;

test.describe('gate · the request-access door has a lock, and the captcha is its key', () => {
  test.beforeAll(async ({ playwright }) => {
    // Skip the whole group when this instance has captcha off (instead of
    // leaving a permanently red test) -- see fixtures/captcha.ts.
    await skipUnlessCaptchaOn(await playwright.request.newContext());
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    // Accepting a note presupposes this instance **can deliver codes** --
    // `gate-client.tsx:38` only renders that panel when `canDeliverCodes` is
    // true. An owner who would actually receive notes would already have
    // mail configured, so this is not manufacturing conditions for the test,
    // it's filling in the precondition (the first version skipped it and
    // went red on "the panel doesn't exist", which isn't what this spec
    // guards).
    await configureMailConnector(request, OWNER.email, OWNER.password);
    await request.dispose();
  });

  test('past the threshold the form demands a human check, and solving it still delivers the note',
    async ({ page }) => {
      await goto(page, '/gate');
      await expect(page.getByTestId('request-panel')).toBeVisible({ timeout: 10_000 });

      // First prove this path normally works -- otherwise "later gets blocked"
      // could mean it was already blocked from the first one, which would be
      // testing a broken form, not a working gate.
      await sendNote(page, 0);
      await expect(
        page.getByTestId('request-sent'),
        'the first note goes through — the gate is not simply broken',
      ).toBeVisible({ timeout: 10_000 });

      for (let i = 1; i < FLOOD; i++) {
        await goto(page, '/gate');
        await sendNote(page, i);
      }

      // Past the threshold: this note gets blocked, and **the key is offered**
      // (not just left with a bare refusal).
      await goto(page, '/gate');
      await sendNote(page, FLOOD);
      await expect(
        page.getByTestId('request-captcha'),
        'past the threshold the door must offer the human check, not just refuse — a refusal with '
          + 'no way through is how a real person gets locked out of asking',
      ).toBeVisible({ timeout: 15_000 });

      // After solving it, the note still goes through.
      await expect(
        page.getByTestId('request-submit'),
        'while unsolved the submit stays blocked, so the sender knows what is missing',
      ).toBeDisabled({ timeout: 10_000 });
      await expect(
        page.getByTestId('request-submit'),
        'once the check issues its token the note goes through',
      ).toBeEnabled({ timeout: 30_000 });
      await page.getByTestId('request-submit').click();
      await expect(
        page.getByTestId('request-sent'),
        'a solved check delivers the note — the lock costs a script, not a person',
      ).toBeVisible({ timeout: 15_000 });
    });

  // Continuing from the previous test: by now that IP is already past the
  // note door's threshold, so sending one more here is guaranteed to be
  // blocked -- and blocked at the **note door**. The gate has three doors
  // (code / BYOAI / note); the previous `useGate` had only one shared
  // SubmitState, so when the note door blocked, the "enter access code"
  // field also lit up red + popped a human check: a door that was never
  // locked announcing itself locked, for a reason that belonged to another
  // door (F-G-6).
  test('the refusal shows up on the door that was used, and leaves the other doors alone',
    async ({ page }) => {
      await goto(page, '/gate');
      await sendNote(page, FLOOD + 1);

      // Positive control first: this note really was blocked, and blocked at
      // the note door. Without this, the two "the code field shows nothing"
      // checks below would also pass if the page never even loaded.
      await expect(
        page.getByTestId('request-captcha'),
        'the note door is the one that refused, so the check belongs to it',
      ).toBeVisible({ timeout: 15_000 });

      await expect(
        page.getByTestId('code-panel').getByTestId('gate-captcha'),
        'the code door was never used and is not locked — it must not demand a human check',
      ).toHaveCount(0);
      await expect(
        page.getByTestId('code-panel').getByTestId('gate-error'),
        'a refusal earned at the note door must not be printed under the code input',
      ).toHaveCount(0);
    });
});

// sendNote -- act like a human: expand the "write a note v" collapsible first,
// then fill in the four fields and submit.
// The collapsible re-closes every time /gate reloads, so each note has to
// expand it itself (the form is not open by default).
async function sendNote(page: Page, i: number): Promise<void> {
  const open = page.getByRole('button', { name: /write a note/i });
  if (await open.isVisible()) {
    await open.click();
  }
  const answered = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/api/v1/access-requests'),
    { timeout: 15_000 },
  );
  await page.getByTestId('request-name').fill(`Flood Probe ${i}`);
  await page.getByTestId('request-org').fill('audit');
  await page.getByTestId('request-email').fill(`flood-${i}@example.invalid`);
  // The body must exceed WHY_MIN (15 chars) for the form to allow submit --
  // this rule belongs to the product, so write to match it.
  await page.getByTestId('request-message')
    .fill(`note number ${i}: asking for a code to talk about the audit`);
  await page.getByTestId('request-submit').click();
  await answered;
}
