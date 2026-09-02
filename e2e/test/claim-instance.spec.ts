// claim-instance.spec.ts -- the real user path through the first-run claim flow.
//
// User story:
//   a freshly deployed StandMeet instance has no owner yet. The owner opens the domain
//   / -- the server finds it unclaimed -> auto-redirects to /setup?t=<token>, the token
//   coming back from the backend's plaintext generated at boot, sent along with
//   /api/v1/instance. The owner fills in name / handle / public_url -> next fills in
//   email + password -> submits -> auto-lands on their own public page /.

import type { Page } from '@playwright/test';

import { execSQL, resetInstance } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';
import { test, expect } from '@/fixtures/test';

const OWNER = {
  full: 'Alice Anderson',
  handle: 'alice',
  publicUrl: 'http://localhost:38127',
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
};

test.describe('owner claims a fresh instance via /setup', () => {
  test.beforeAll(() => {
    resetInstance();
  });

  test('opening / on a fresh instance lands the owner in the claim wizard and admin',
    async ({ page }) => {
      // After the entry fixture's goto('/'): unclaimed -> server redirects to /setup?t=...
      await page.waitForURL(/\/setup\?t=/, { timeout: 10_000 });

      await fillIdentityStep(page);       // step 1 → 2
      await fillCredentialsStep(page);    // step 2 → 3
      await fillProviderStepSkip(page);   // step 3 → 4 (AI key can be blank, fill in later via admin)
      await fillVerifyStep(page);         // step 4 → submit
      await expectLandedOnAdmin(page);
    });

  // F-L-56 -- **the setup link the instance itself hands out must actually be able
  // to claim.**
  //
  // Hit in a real environment (full suite #3, partway through, then the following ~130
  // test cases all died at 0ms on `claim failed after 3 attempts: 401`): the token that
  // instance handed out and the hash stored in its own DB **did not match**. Measured
  // on the spot:
  //   hash(token from the API) = 21407ef2...   setup_token_hash in DB = 1b8b3f91...
  //
  // How it got that way: `IssueSetupToken` **writes the DB hash first, then sets the
  // in-memory holder**, with no lock between the two. Two concurrent requests (the
  // homepage SSR asks `/api/v1/instance` once per render) interleaving once is enough:
  //   A writes hash(TA) -> B writes hash(TB) -> B sets holder=TB -> A sets holder=TA
  // leaving holder=TA while DB=hash(TB). **And the self-heal check is "hash present &&
  // holder non-empty" -- both conditions still hold in this bad state**, so it never
  // self-heals: the owner's `/setup?t=...` link stays 401 forever, until someone
  // restarts the backend. Self-hosting dies right here in its first minute.
  //
  // This test case **does not try to reproduce the race** (reproducing a race is a
  // gamble, and the opposite failure -- [[assertion-that-cannot-fail]] -- is just as
  // bad). It builds the **bad state** directly instead -- that's the invariant worth
  // guarding: **no matter how memory and the DB diverge, the link the instance hands
  // out must still work.**
  test('a setup link the instance hands out always claims, even after the two halves diverge',
    async ({ page }) => { await claimAfterDivergence(page); });
});

// claimAfterDivergence -- first let it issue normally once (hash and holder in sync),
// then unilaterally change the DB's half: this is the shape left behind after an
// interleaving -- holder has a value, hash has a value, but they're not a matching pair.
// Then walk the owner's own path and assert **the good outcome**: they get into admin.
async function claimAfterDivergence(page: Page): Promise<void> {
  resetInstance();
  await goto(page, '/');
  await page.waitForURL(/\/setup\?t=/, { timeout: 10_000 });
  execSQL(`UPDATE instance_settings SET setup_token_hash = `
    + `'0000000000000000000000000000000000000000000000000000000000000000' WHERE id = 1`);

  await goto(page, '/');
  await page.waitForURL(/\/setup\?t=/, { timeout: 10_000 });
  await fillIdentityStep(page);
  await fillCredentialsStep(page);
  await fillProviderStepSkip(page);
  await fillVerifyStep(page);
  // When red, this stalls on the setup page -- which is exactly what the owner sees
  // in the real world: fill everything in, then nothing happens.
  await expectLandedOnAdmin(page);
}

async function fillIdentityStep(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: /Claim this/ })).toBeVisible();
  await page.getByTestId('full').fill(OWNER.full);
  await page.getByTestId('handle').fill(OWNER.handle);
  await page.getByTestId('public-url').fill(OWNER.publicUrl);
  await page.getByTestId('next').click();
}

async function fillCredentialsStep(page: Page): Promise<void> {
  await page.getByTestId('email').fill(OWNER.email);
  await page.getByTestId('password').fill(OWNER.password);
  await page.getByTestId('password-confirm').fill(OWNER.password);
  await page.getByTestId('next').click();
}

async function fillProviderStepSkip(page: Page): Promise<void> {
  // Leave the AI provider step blank ("you can skip this for now and configure later
  // under admin -> account" -- per the design). Just hit next into verify.
  await expect(page.getByTestId('setup-ai-key')).toBeVisible({ timeout: 5_000 });
  await page.getByTestId('next').click();
}

// fillVerifyStep -- step 4 is now just a review card; submit directly.
//
// This used to scrape an `a + b =` puzzle off the page, compute the answer, and fill
// it in. That arithmetic gate has been removed (F-H-1): **the backend never validated
// it** (`routes/admin/claim.go`'s `claimRequest` has no check on that field); the real
// authorization is the one-time setup token -- so the puzzle never blocked any bot, it
// only blocked the owner's own agent, and this product needs exactly that: to be
// drivable purely by automation.
async function fillVerifyStep(page: Page): Promise<void> {
  await page.getByTestId('submit').click();
}

// After SetupForm submits successfully, router.push('/admin') -- the owner lands
// straight in admin to start managing once deployed. /admin server-side redirects to
// **/admin/dashboard** (see app/admin/page.tsx: a returning owner should see the global
// state first, not drop straight into the public-face editor). This assertion used to
// check /admin/page -- the product changed its landing page and the test didn't keep
// up, so it was guarding a behavior that no longer existed.
// AdminShell treats the session cookie the claim flow wrote as ready and renders the
// sidebar (including the "page" link).
async function expectLandedOnAdmin(page: Page): Promise<void> {
  await page.waitForURL('**/admin/dashboard', { timeout: 10_000 });
  await expect(page.getByTestId('admin-nav-page')).toBeVisible();
}
