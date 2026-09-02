// gate-captcha-unlock.spec.ts —— F-G-3: a visitor locked out by the per-IP guard must be
// able to use the way out the product itself already documents.
//
// The backend **accepts** this already: `sessions.go`'s `captcha_token`, and
// `code_guard.go:56`'s `Locked = enabled && overThreshold && captchaFails` — a token
// that passes verification unlocks it. But `TurnstileWidget` is mounted nowhere in the
// repo except `LoginForm.tsx` (**the owner's login page**). So a visitor who fumbles the
// code ten times gets locked out for 15 minutes with no way out on screen: the
// capability exists on the backend, the face was never built (same family as
// F-D-9 / F-N-4).
//
// **This can only be driven with captcha genuinely turned on**: the widget only renders
// when the instance has published a site key, while every other spec runs against the
// default shape with captcha off (which is also how the product ships). So this spec
// runs via `make test-captcha` — it brings up the stack with Cloudflare's official
// **always-passes** test keys. That keypair issues its own token; there's no puzzle to
// solve.
//
// Two criteria:
//   (1) once locked, a captcha appears on the gate;
//   (2) submitting the solved token actually unlocks it — try the **same real code**
//       once before the lock and once after, expecting a refusal before and entry after
//       carrying the token. Asserting only (1) would let a component that renders but
//       isn't wired through pass too — which is exactly the shape of this defect.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { skipUnlessCaptchaOn } from '@/fixtures/captcha';
import { createCode } from '@/fixtures/codes';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'captcha-gate@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'captchagate',
  fullName: 'Captcha Gate Owner',
};
const GOOD_CODE = 'LETMEIN-001';
// codeFailMax = 10 (code_guard.go). Try a couple extra so we don't sit right on the
// boundary.
const WRONG_TRIES = 12;

test.describe('gate · a locked visitor is offered the way out the backend already accepts', () => {
  test.beforeAll(async ({ playwright }) => {
    // Skip the whole group when this instance doesn't have captcha on (rather than
    // leaving a permanently red test) — see fixtures/captcha.ts.
    await skipUnlessCaptchaOn(await playwright.request.newContext());
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await createCode(request, csrf, { code: GOOD_CODE, label: 'letmein' });
    await request.dispose();
  });

  test('captcha on + locked out ⇒ the gate shows a captcha, and solving it lets a real code through',
    async ({ page }) => {
      await goto(page, '/gate');
      // First prove captcha is genuinely on — otherwise "no widget" below would just
      // mean this instance was never configured for it, and the spec would go red on
      // the environment rather than on the defect ([[red-in-the-wrong-place]]).
      await expect(
        page.getByTestId('gate-captcha'),
        'captcha must be configured for this spec — run it via `make test-captcha`',
      ).toHaveCount(0, { timeout: 5_000 });

      // Keep submitting wrong codes **until the gate actually falls**. Not a fixed
      // 12 tries: once locked, the submit button should be disabled (see below), and
      // typing into a form that never sends a request just times out.
      for (let i = 0; i < WRONG_TRIES && !(await locked(page)); i++) {
        await submitCode(page, `NOPE-${String(i).padStart(3, '0')}`);
      }

      // (1) Locked out → the gate must offer that way out.
      await expect(
        page.getByTestId('gate-captcha'),
        'a locked visitor must be offered the captcha the backend accepts, not just refused',
      ).toBeVisible({ timeout: 15_000 });

      // (1b) And the refusal message must **point at** that way out. This instance has
      // captcha configured, so the check is sitting right there on screen — saying
      // "try again later" would just hide it and leave the visitor waiting fifteen
      // minutes for nothing. The mirror half (never promising a check that doesn't
      // exist when captcha isn't configured) is guarded by
      // `gate-lock-offers-only-what-exists` (F-G-7).
      await expect(
        page.getByTestId('code-panel').getByTestId('gate-error'),
        'with a check on screen the refusal must point at it, not tell the visitor to wait',
      ).toContainText('human check', { timeout: 10_000 });

      // (2) And it must actually be wired through: the test keypair issues its own
      // token, and submitting a real code with that token should let the visitor in.
      //
      // Wait for the button to flip from disabled back to enabled — that's the visible
      // signal that **the token has arrived**. An earlier version submitted the moment
      // it saw the check box, so it sent the request before the token existed and the
      // backend still returned 429: that was racing against a condition of my own
      // making, and a real visitor would hit the same race (which is why that control is
      // genuinely disabled now, not just for the test's benefit).
      await expect(
        page.getByTestId('gate-code-submit'),
        'while locked and unsolved, submitting must be blocked — otherwise the visitor keeps '
          + 'hitting the same 429 with no idea whether to wait or give up',
      ).toBeDisabled({ timeout: 10_000 });
      // After each refusal the input shakes and clears itself (`useShakeOnError`). Wait
      // for it to finish clearing before typing — an earlier version filled the code
      // before the clear finished, so the timer wiped it out and Enter submitted an
      // empty string, and no request was ever sent. A real person also waits for it to
      // finish before retyping.
      await expect(page.getByTestId('gate-code')).toHaveValue('', { timeout: 5_000 });
      await page.getByTestId('gate-code').fill(GOOD_CODE);
      await expect(
        page.getByTestId('gate-code-submit'),
        'once the captcha issues its token the gate must let the code through',
      ).toBeEnabled({ timeout: 30_000 });
      await submitCode(page, GOOD_CODE);
      await expect(
        page.getByTestId('session-strip'),
        'a solved captcha must actually lift the lock — a widget that renders but sends no token '
          + 'leaves the visitor exactly as stuck',
      ).toBeVisible({ timeout: 20_000 });
    });
});

// locked —— whether the gate has actually fallen: goes by **the backend's refusal
// message**, taken as the source of truth.
//
// An earlier version asked "has the human-check appeared", but that box now holds
// nothing but a Turnstile iframe: its height is 0 before it finishes loading, so
// `isVisible()` is false — the loop thinks it isn't locked yet and keeps submitting,
// while the button is already disabled, so nothing gets sent and it just times out.
// **Using something that hasn't finished painting as the criterion measures whether it
// finished painting, not whether the gate has fallen.**
async function locked(page: Page): Promise<boolean> {
  const said = await page.getByTestId('code-panel').getByTestId('gate-error')
    .textContent().catch(() => null);
  return (said ?? '').includes('human check');
}

// submitCode —— fills the code and confirms like a person would, then **waits for this
// submission to actually get a response**.
// Not a timed wait: that's both slow and, on a busy machine, mistakes "hasn't come back
// yet" for "came back" ([[timeout-is-not-proof-of-not-done]]).
async function submitCode(page: Page, code: string): Promise<void> {
  const answered = page.waitForResponse(
    (r) => r.request().method() === 'POST' && /\/api\/v1\/(sessions|codes\/intro)/.test(r.url()),
    { timeout: 15_000 },
  );
  // Press Enter rather than click the button: every refusal inserts an error line that
  // shifts the button, so clicking gets stuck on "element is not stable" — that's me
  // racing the layout, not a product defect. The hint on screen already says press
  // enter, and that's what a person would do.
  const field = page.getByTestId('gate-code');
  await field.fill(code);
  await field.press('Enter');
  await answered;
}
