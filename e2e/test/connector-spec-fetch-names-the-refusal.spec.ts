// connector-spec-fetch-names-the-refusal.spec.ts -- F-C-23: a fetch blocked by the SSRF
// gate must not be reported as "is it unreachable?".
//
// Found by driving the real environment: on prod's add-connector panel, filling the spec
// URL with `http://standmeet-prod-app-1:3000/` (on the same docker network) got back
// *"could not fetch the spec from that URL (is it reachable?)"*. That address is
// **definitely reachable** -- wget from inside the backend container gets a 200 OK. So
// this was the gate refusing on policy, while telling the owner to go troubleshoot their
// own network. A sibling endpoint in the same repo already separates these
// (`inference_models.go`'s `endpoint_blocked`).
//
// Both assertions are required, and they point in **opposite directions**:
//   1. An internal address -> the message must name "address policy";
//   2. An unresolvable public domain -> the message must **still** be about reachability,
//      must not get folded into the same wording.
// Asserting only #1 would let a lazy fix through -- one that reports every fetch failure
// as "internal" -- that's just the lie pointed a different way, and worse: the owner
// would go hunt for an internal-network problem that doesn't exist.

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

// PRIVATE_URL -- a literal private-network IP: judged statically, no DNS involved, so
// it's both fast and free of any ambiguity from the resolution step.
const PRIVATE_URL = 'http://10.255.255.1/openapi.json';
// UNRESOLVABLE_URL -- `.invalid` is a reserved TLD that never resolves. It is **not** an
// internal address.
const UNRESOLVABLE_URL = 'https://standmeet-verify-no-such-host.invalid/openapi.json';

// NAMES_THE_ADDRESS -- asserts that "the message names the address policy", not any
// specific wording: the exact wording is the product's choice, being able to state it at
// all is the invariant.
const NAMES_THE_ADDRESS = /internal|private|not allowed/i;

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

async function claimOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}

async function fetchSpecFrom(page: Page, url: string): Promise<void> {
  await page.getByTestId('connector-spec-url-input').fill(url);
  await page.getByTestId('connector-spec-fetch-button').click();
}

test.describe('connector · spec fetch names which refusal it is', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimOwner(playwright);
  });

  // Internal address -> names the address policy; unresolvable domain -> still reports
  // reachability (both directions required, see the file header).
  test('internal address names the address policy; unresolvable host still says reachability',
    async ({ adminPage: page }) => {
    test.setTimeout(180_000);
    // Navigates in through the sidebar (not page.goto), same entry point as
    // connector-spec-ingest.
    await page.getByTestId('admin-nav-connectors').click();
    await page.waitForURL('**/admin/connectors**');
    await page.getByTestId('connector-add-open').click();

    const err = page.getByTestId('connector-spec-error');

    // 1) The kind blocked by the gate.
    await fetchSpecFrom(page, PRIVATE_URL);
    await expect(err).toBeVisible({ timeout: 30_000 });
    // Non-empty guard: proves this error message is actually saying something first,
    // otherwise empty text would also make the check below look like it passed for a
    // reason.
    await expect(err).not.toHaveText('');
    await expect(err).toHaveText(NAMES_THE_ADDRESS);

    // 2) The kind that's genuinely unreachable -- must not get folded into "internal".
    await fetchSpecFrom(page, UNRESOLVABLE_URL);
    await expect(err).toBeVisible({ timeout: 30_000 });
    await expect(err).not.toHaveText('');
    await expect(err).not.toHaveText(NAMES_THE_ADDRESS);
  });
});
