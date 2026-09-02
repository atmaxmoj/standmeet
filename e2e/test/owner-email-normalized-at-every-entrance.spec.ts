// owner-email-normalized-at-every-entrance.spec.ts —— email normalization cannot live
// at only one use site.
//
// Defect (audited 2026-08-30): `usecase.normalizeEmail` (trim + lowercase) is **only
// ever called by change_email**. The three entry points `claim` / `login` / `recover`
// all pass the raw value straight through.
//
// Case gets lucky and causes no harm — `owners.email` is `citext`. **Whitespace does**:
// citext doesn't trim. Claim with a leading space, and that space-carrying string
// becomes the identity — normal input can never log in again after that, and recover
// can't rescue it either (same lookup path). The owner locks themself out at the very
// first step, with no hint that anything went wrong.
//
// This is the textbook case for CLAUDE.md A4: normalize incoming data once at the
// entrance, and downstream can always trust the field. The current shape is
// "normalized at one use site", with the other three running bare.
//
// Criterion: normalization only counts as working if **the clean form can actually log
// in**. Asserting only that /me displays lowercase isn't enough — the display layer
// could easily do its own toLowerCase, while login runs through a different path
// ("which path is the green running on").

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import {
  clearMailpit, configureMailConnector, confirmLinkIn, followMailedLink,
  recoveryPhraseIn, waitForMailTo,
} from '@/fixtures/mail';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// The dirty form at the door: leading/trailing whitespace + mixed case. All the
// trouble in one string.
const DIRTY = '  Nadia@Example.COM  ';
const CLEAN = 'nadia@example.com';
const PASSWORD = 'correct-horse-battery-staple';

async function loginStatus(
  request: APIRequestContext, email: string, password: string,
): Promise<number> {
  const res = await request.post(`${BACKEND}/api/admin/login`, {
    data: { email, password },
  });
  return res.status();
}

test.describe('owner email · normalized at the entrance, not at one use site', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    // claim —— this is the first entry point where an email enters the system, and
    // today it's also the one entry point with no normalization at all.
    await claim(request, findSetupToken(), {
      email: DIRTY, password: PASSWORD, handle: 'nadia', fullName: 'Nadia Normal',
    });
    await request.dispose();
  });

  test('claimed with whitespace and mixed case → the clean form is the identity',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();

      // (1) The clean form must log in — this is what the owner will actually type
      // next time.
      expect(await loginStatus(request, CLEAN, PASSWORD)).toBe(200);

      // (2) What's stored is the clean form (not papered over by a display-layer
      // toLowerCase).
      const { csrf } = await login(request, CLEAN, PASSWORD);
      const me = await request.get(`${BACKEND}/api/admin/me`, {
        headers: { 'X-Csrftoken': csrf },
      });
      expect(me.status()).toBe(200);
      expect((await me.json() as { owner: { email: string } }).owner.email).toBe(CLEAN);

      // (3) The dirty form also logs in — login normalizes too, or the owner would be
      // locked out by a stray copy-pasted space.
      expect(await loginStatus(request, DIRTY, PASSWORD)).toBe(200);

      await request.dispose();
    });

  // `recover` is the third entry point that looks a person up by email
  // (`usecase/recovery.go:105`).
  //
  // The first version of this test wrote it as "the dirty form and clean form return
  // the same status code" — that assertion is **always green**: a wrong phrase and a
  // no-such-owner are deliberately given the same code (anti-enumeration), so both
  // sides being an error doesn't show any difference. Switched to walking the
  // **success path** instead: take a real recovery phrase, and recover using the
  // clean form. There's only one way to succeed, and it can't be faked
  // ([[assertion-that-cannot-fail]]).
  test('recovery finds the same owner through the clean form of a dirty-claimed email',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await configureMailConnector(request, CLEAN, PASSWORD);
      await clearMailpit(request);
      // Fetch csrf **after** configureMailConnector: it logs in itself internally,
      // which swaps out the session, invalidating a token fetched earlier (403).
      const { csrf } = await login(request, CLEAN, PASSWORD);

      const gen = await request.post(`${BACKEND}/api/admin/account/recovery`, {
        headers: { 'X-Csrftoken': csrf }, data: {},
      });
      expect(gen.status()).toBe(200);
      const phrase = recoveryPhraseIn(await waitForMailTo(request, CLEAN));

      // The owner is locked out, typing the clean address they remember — while what
      // was stored is the dirty string from claim time.
      const fresh = await playwright.request.newContext();
      const rec = await fresh.post(`${BACKEND}/api/admin/recover`, {
        data: { email: CLEAN, recovery_phrase: phrase },
      });
      expect(rec.status(), 'recover 认不出干净形式 = 锁在外面救不回来').toBe(200);
      await fresh.dispose();
      await request.dispose();
    });

  // change_email also goes through the same single chokepoint — including the
  // **pending** tier.
  //
  // An earlier version of this test directly asserted "the clean form logs in right
  // after the change", which relied on something never written down: this instance
  // has no mail connector. The previous test case configured one, so the change
  // instead walked into the pending path — the identity never actually changed, and
  // the assertion went red right away — red for the right symptom, but for a reason
  // with nothing to do with normalization. Now the whole path is walked to
  // completion: the dirty form goes in → click the confirmation link → the clean form
  // becomes the identity.
  test('the normalization lives at the one chokepoint, including the pending path',
    async ({ page, playwright }) => {
      const request = await playwright.request.newContext();
      await configureMailConnector(request, CLEAN, PASSWORD);
      await clearMailpit(request);
      const { csrf } = await login(request, CLEAN, PASSWORD);

      const moved = '  Nadia+Moved@Example.COM  ';
      const clean = 'nadia+moved@example.com';
      const res = await request.patch(`${BACKEND}/api/admin/account/email`, {
        headers: { 'X-Csrftoken': csrf },
        data: { current_password: PASSWORD, new_email: moved },
      });
      expect(res.status()).toBe(200);

      // What the pending column stores must be the clean form — it's going to become
      // the email column eventually, and both sides need to be measured with the same
      // ruler (SetPendingEmail also goes through repo.NormalizeEmail). The
      // confirmation mail is also sent to the clean form, so it's fine to wait for the
      // mail addressed to the clean form directly.
      const link = confirmLinkIn(await waitForMailTo(request, clean), 'confirm-email');
      await followMailedLink(page, link);
      // Wait for the confirmation to actually finish before asserting — that POST
      // fires from a useEffect after hydration, and hasn't happened yet when
      // `page.goto` returns. Not waiting means asserting a fact that hasn't happened.
      await expect(page.getByTestId('email-confirmed')).toBeVisible({ timeout: 15_000 });

      expect(await loginStatus(request, clean, PASSWORD)).toBe(200);
      // The dirty form logs in just as well — the lookup side uses the same rules.
      expect(await loginStatus(request, moved, PASSWORD)).toBe(200);
      await request.dispose();
    });
});
