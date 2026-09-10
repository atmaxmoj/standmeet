// homepage-auto-goes-live-at-claim.spec.ts — a fresh (unedited) instance serves the default homepage
// at `/` immediately, with nothing to publish.
//
// Q1 changed the mechanism: the default homepage is NO LONGER materialized into the owner's storage
// at claim (that froze a starter template at claim-time's code and showed EDIT-ME placeholder junk).
// Now `/` serves DefaultHome — rendered from CURRENT code (SDK widgets) via the visitor fallback — so
// it can never go stale and needs no build/publish. This asserts the outcome the owner cares about:
// claim, and the homepage is up at `/` with no manual step.
//
// RED if `/` stopped serving the default on a claimed, unedited instance.

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { openReader } from '@/fixtures/navigate';

const OWNER = {
  email: 'autolive@example.com', password: 'correct-horse-battery-staple',
  handle: 'autolive', fullName: 'Auto Live Owner',
};

test.describe('a fresh instance serves the default homepage at / (no materialization)', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(60_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('after claim, / serves DefaultHome with no publish/materialization', async ({ page }) => {
    test.setTimeout(60_000);
    await openReader(page, '/');
    await expect(page.getByTestId('default-home'),
      'a claimed, unedited instance serves DefaultHome at the site root').toBeVisible({ timeout: 20_000 });
  });
});
