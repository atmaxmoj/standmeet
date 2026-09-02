// setup-wizard-4step.spec.ts -- the 4-step wizard for the first-run claim.
//
// Business story:
//   step 1 identity -> step 2 credentials -> step 3 AI provider (skippable) ->
//   step 4 verify (arithmetic captcha + a summary card) -> submit -> /admin.
//   The step progress bar has 4 segments; the back / next / submit button testids are
//   reused across steps.
//
// Playwright test isolation: every test gets a fresh page (even under
// describe.serial). Each case walks through its own preceding steps rather than
// assuming state is shared across cases.

import type { Page } from '@playwright/test';

import { resetInstance } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
import { test, expect } from '@/fixtures/test';

const OWNER = {
  full: 'Sijie Wang',
  handle: 'sijie',
  publicUrl: 'http://localhost:38127',
  email: 'sijie@example.com',
  password: 'correct-horse-battery-staple',
};

test.describe('first-run claim · 4-step wizard polish', () => {
  test.beforeEach(() => { resetInstance(); });

  test('step 1 missing fields → next disabled; fill → enabled + advance',
    async ({ page }) => {
      await page.waitForURL(/\/setup\?t=/, { timeout: 10_000 });
      const nextBtn = page.getByTestId('next');
      await expect(nextBtn).toBeDisabled();
      await fillStep1(page);
      await expect(nextBtn).toBeEnabled();
      await nextBtn.click();
      await expect(page.getByTestId('email')).toBeVisible({ timeout: 5_000 });
    });

  test('step 2 password mismatch error; correct → step 3',
    async ({ page }) => {
      await page.waitForURL(/\/setup\?t=/, { timeout: 10_000 });
      await fillStep1(page);
      await page.getByTestId('next').click();
      await page.getByTestId('email').fill(OWNER.email);
      await page.getByTestId('password').fill(OWNER.password);
      await page.getByTestId('password-confirm').fill('wrong');
      await page.getByTestId('next').click();
      await expect(page.getByTestId('error')).toContainText(/don.t match/i);
      await page.getByTestId('password-confirm').fill(OWNER.password);
      await page.getByTestId('next').click();
      await expect(page.getByTestId('setup-ai-key')).toBeVisible({ timeout: 5_000 });
    });

  test('full flow with captcha → /admin',
    async ({ page }) => {
      await page.waitForURL(/\/setup\?t=/, { timeout: 10_000 });
      await fillStep1(page);
      await page.getByTestId('next').click();
      await fillStep2(page);
      await page.getByTestId('next').click();
      await page.getByTestId('next').click(); // skip provider
      await submitReview(page);
      // Landing on /admin means the dashboard (app/admin/page.tsx's server redirect).
      await page.waitForURL('**/admin/dashboard', { timeout: 10_000 });
    });

  // F-H-2: the key collected at step 3 **must actually be persisted**.
  //
  // Nobody guarded this before: both of the existing full-flow tests just clicked next
  // through step 3 ("skippable"), so "what happens if it's filled in" was never asked --
  // and the one time an instance was actually rebuilt with the key filled in, the review
  // card still printed `AI · DeepSeek · deepseek-chat`, the claim still succeeded, and yet
  // not a single character of the key ever got written.
  //
  // The assertion lands on **the surface an owner would actually check afterward**
  // (/admin/api·mcp), not on the claim response: that's exactly what an owner looks at to
  // judge "is this configured", and the endpoint being filled back in as deepseek's base
  // URL happens to prove the provider also got persisted (a value this step never even
  // had the owner type in).
  test('the AI key typed at step 3 is configured by the time the wizard lands in admin',
    async ({ page }) => {
      await page.waitForURL(/\/setup\?t=/, { timeout: 10_000 });
      await fillStep1(page);
      await page.getByTestId('next').click();
      await fillStep2(page);
      await page.getByTestId('next').click();
      await fillStep3Provider(page);
      await page.getByTestId('next').click();
      await submitReview(page);
      await page.waitForURL('**/admin/dashboard', { timeout: 10_000 });
      await gotoAdminSection(page, 'api-mcp');
      await expectProviderOnFile(page);
    });

  // There used to be a test here for `wrong captcha → error, stays on /setup`. **That
  // invariant went away along with the control it guarded** (F-H-1: the arithmetic box was
  // never validated server-side, it only ever blocked the owner's own agent, not a real
  // bot, so it was deleted).
  //
  // What replaces it is the guard that actually matters: **a bad setup token must be
  // rejected**. That's what actually authorizes this step -- a one-time token printed in
  // the backend logs, obtainable only by whoever can read the server, and it's
  // **validated server-side**.
  //
  // Verified at the API layer rather than through the GUI: swapping in a different token
  // requires a different URL, and the e2e lint bans `page.goto` (requiring navigation from
  // a known entry point by clicking through -- that rule is correct). **Swapping the token
  // is inherently an API-layer concern** -- on the GUI path the token is supplied by the
  // environment, and there's no way to test against "a different token" from there.
  test('a bad setup token is refused by the server', async ({ request }) => {
    const res = await request.post(`${BACKEND}/api/admin/claim`, {
      data: {
        token: 'not-a-real-setup-token',
        email: OWNER.email, password: OWNER.password,
        handle: OWNER.handle, full_name: OWNER.full, public_url: OWNER.publicUrl,
      },
    });
    expect(res.status(), 'a forged setup token must not claim the instance').toBe(401);
    const body = await res.json() as { error?: { code?: string } };
    expect(body.error?.code, 'and the refusal names what was wrong').toBe('invalid_setup_token');
  });
});

async function fillStep1(page: Page): Promise<void> {
  await page.getByTestId('full').fill(OWNER.full);
  await page.getByTestId('handle').fill(OWNER.handle);
  await page.getByTestId('public-url').fill(OWNER.publicUrl);
}

async function fillStep2(page: Page): Promise<void> {
  await page.getByTestId('email').fill(OWNER.email);
  await page.getByTestId('password').fill(OWNER.password);
  await page.getByTestId('password-confirm').fill(OWNER.password);
}

async function fillStep3Provider(page: Page): Promise<void> {
  await page.getByTestId('setup-provider-deepseek').click();
  await page.getByTestId('setup-ai-model').fill('deepseek-chat');
  await page.getByTestId('setup-ai-key').fill('sk-setup-wizard-fake-key');
}

// expectProviderOnFile -- confirms on /admin/api·mcp that step 3's configuration is
// genuinely persisted. The endpoint is the hardest criterion of the bunch: this step
// never had the owner type it in, so it can only have come from the server looking it up
// against the preset table by provider.
async function expectProviderOnFile(page: Page): Promise<void> {
  await expect(
    page.getByTestId('ai-provider-key'),
    'the key from step 3 must be on file, not thrown away',
  ).toHaveAttribute('placeholder', /already set/);
  await expect(page.getByTestId('ai-provider-endpoint'))
    .toHaveValue('https://api.deepseek.com');
  await expect(page.getByTestId('ai-provider-model')).toHaveValue('deepseek-chat');
}

// submitReview -- step 4 is now just a review card, submits directly (the arithmetic box
// has been removed, see F-H-1).
async function submitReview(page: Page): Promise<void> {
  await page.getByTestId('submit').click();
}
