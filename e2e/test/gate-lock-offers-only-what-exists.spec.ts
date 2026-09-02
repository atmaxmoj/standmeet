// gate-lock-offers-only-what-exists.spec.ts — F-G-7: the sentence shown when the gate
// blocks a visitor may only promise a next step **this instance can actually deliver
// right now**.
//
// The gate's two doors (invalid code / notes) each carry a per-IP throttle, and either
// throttle can be cleared by a human check — **but only an instance with captcha
// configured has that check at all**, and the default deployment doesn't
// (`TURNSTILE_*` unset -> `CaptchaEnabled=false`). The previous version hardcoded both
// refusal messages to "clear a human check to continue", so on **the vast majority** of
// deployments, a blocked visitor read about a control that doesn't exist anywhere on the
// page; they'd go looking for it, fail to find it, and conclude they were permanently
// locked out.
//
// This spec runs against the **default stack** (captcha off) — exactly the kind of
// deployment where that sentence is most likely to mislead. The reverse half (when
// captcha IS on, the refusal must **name** that way out, instead of saying "try again
// later") is guarded by `captcha-on-gate-unlock`; only together do the two pin down "what
// it says matches what actually exists".

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { configureMailConnector } from '@/fixtures/mail';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'lock-copy@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'lockcopy',
  fullName: 'Lock Copy Owner',
};

// NOTE_FLOOD / CODE_FLOOD — each exceeds its throttle's threshold (notes 5 / invalid codes 10).
const NOTE_FLOOD = 7;
const CODE_FLOOD = 12;

test.describe('gate · a refusal names a way out only when there is one', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await configureMailConnector(request, OWNER.email, OWNER.password);
    await request.dispose();
  });

  // Verify the precondition first, never assume it. This spec is about "an instance with
  // **no captcha configured**", and whether captcha is on depends on the environment —
  // `docker compose` auto-reads the repo root's `.env`, and the test key pair filled in
  // for prod accidentally lit up the dev stack too, so the first time these two test
  // cases went red, **the red was in the wrong place**: on that stack, the product's
  // "clear a human check" message was actually correct. Without asserting the
  // precondition, a red run looks exactly like a real defect.
  test.beforeEach(async ({ page }) => {
    const res = await page.request.get('/api/v1/instance');
    const body: unknown = await res.json();
    const siteKey = typeof body === 'object' && body !== null && 'captcha_site_key' in body
      ? body.captcha_site_key : '';
    expect(
      siteKey ?? '',
      'this spec is about an instance with NO captcha — run it on the default stack '
        + '(no TURNSTILE_* in the shell and none in .env), not through make test-captcha',
    ).toBe('');
  });

  test('the note door, with no captcha configured, does not send the visitor looking for one',
    async ({ page }) => {
      for (let i = 0; i < NOTE_FLOOD; i++) {
        await goto(page, '/gate');
        await sendNote(page, i);
      }

      // Positive control: the visitor really is blocked, and this message really is
      // printed on the note door. Without this, the two assertions below would also pass
      // on a blank page.
      const err = page.getByTestId('request-error');
      await expect(
        err, 'past the threshold the note door refuses, and says so on the form',
      ).toBeVisible({ timeout: 15_000 });

      // The criterion is **the content of that sentence**: this instance has no captcha
      // configured, no check appears on screen at all, so the sentence must not say
      // "clear a human check".
      await expect(
        err,
        'with no captcha configured there is no check to clear — the refusal must not name one',
      ).not.toContainText('human check');
      await expect(
        page.getByTestId('request-captcha'),
        'and there is indeed no check on screen — which is why naming one would be a lie',
      ).toHaveCount(0);
    });

  test('the code door, with no captcha configured, does not send the visitor looking for one',
    async ({ page }) => {
      await goto(page, '/gate');
      for (let i = 0; i < CODE_FLOOD; i++) {
        await page.getByTestId('gate-code').fill(`NOPE-${String(i).padStart(3, '0')}`);
        // Once the throttle trips, the submit button is disabled (there's no captcha
        // ticket to obtain when captcha is off), so pressing again would send no request
        // at all — so the loop stops right here instead of waiting on a response that
        // will never arrive.
        if (await page.getByTestId('gate-code-submit').isDisabled()) break;
        // Wait for each real round-trip to actually come back before firing the next
        // one — with a fixed sleep instead, a slower machine would fire fewer attempts,
        // the throttle would never trip, and the failure would look like "the product
        // isn't locking".
        const answered = page.waitForResponse(
          (r) => r.request().method() === 'POST' && r.url().includes('/api/v1/sessions'),
          { timeout: 15_000 },
        );
        await page.getByTestId('gate-code').press('Enter');
        await answered;
      }

      const err = page.getByTestId('code-panel').getByTestId('gate-error');
      await expect(
        err, 'past the threshold the code door refuses, and says so under the input',
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        err,
        'with no captcha configured the code door has no check either — do not promise one',
      ).not.toContainText('human check');
      await expect(
        page.getByTestId('gate-captcha'),
        'and there is indeed no check on screen',
      ).toHaveCount(0);
    });
});

// sendNote — fills out and submits that form like a human would. It collapses on every
// /gate navigation, so each note has to be expanded first.
async function sendNote(page: Page, i: number): Promise<void> {
  const open = page.getByRole('button', { name: /write a note/i });
  if (await open.isVisible()) {
    await open.click();
  }
  const answered = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/api/v1/access-requests'),
    { timeout: 15_000 },
  );
  await page.getByTestId('request-name').fill(`Lock Copy ${i}`);
  await page.getByTestId('request-email').fill(`lock-copy-${i}@example.invalid`);
  await page.getByTestId('request-message')
    .fill(`note number ${i}: asking for a code to talk about the audit`);
  await page.getByTestId('request-submit').click();
  await answered;
}
