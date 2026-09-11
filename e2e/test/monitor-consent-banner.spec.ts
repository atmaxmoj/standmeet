// monitor-consent-banner.spec.ts —— the visitor's GDPR tracking-consent banner, end to end.
//
// Tracking is opt-in: a fresh visitor sees an accept/decline banner, and NOTHING is recorded until
// they accept. Declining records nothing; accepting records the visit. Proven on the index surface,
// whose only recorded signal is the browser beacon (the backend otherwise sees just a liveness
// probe) — so gating the beacon on consent fully controls whether the visit is counted.
//
// The core test is differential, not an absence assertion: one visitor declines, another accepts,
// and the owner ends up with EXACTLY ONE new index view — the accept. If declining leaked a view the
// count would be +2 and the poll never settles; if accepting recorded nothing it would be +0. The
// accept is the positive control that proves the pipeline is alive, so the "decline recorded
// nothing" half can't pass on a dead pipeline.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { readEvents } from '@/fixtures/monitor';
import { openInteractiveVisitor } from '@/fixtures/visitor-browser';

const OWNER = {
  email: 'consent-banner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'consentbanner',
  fullName: 'Consent Banner',
};

// indexViews —— how many index VIEWS (event_name empty; scroll/dwell carry a name) the owner holds.
// The index's only recorded signal is the browser beacon, so this counts consenting visitors.
async function indexViews(request: APIRequestContext): Promise<number> {
  const rows = await readEvents(request, OWNER, { surface: 'index' });
  return rows.filter((r) => r.event_name === '').length;
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('monitor · a visitor consents before anything is tracked (GDPR)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('a fresh visitor is shown the accept/decline banner on the homepage', async ({ playwright }) => {
    const visitor = await openInteractiveVisitor(playwright);
    try {
      const page = await visitor.visit('/');
      await expect(page.getByTestId('consent-banner')).toBeVisible();
      await expect(page.getByTestId('consent-accept')).toBeVisible();
      await expect(page.getByTestId('consent-decline')).toBeVisible();
    } finally {
      await visitor.dispose();
    }
  });

  test('declining records nothing; accepting records the visit', async ({ request, playwright }) => {
    const before = await indexViews(request);

    // Visitor A declines. The banner leaves and no beacon should fire.
    const decliner = await openInteractiveVisitor(playwright);
    const aPage = await decliner.visit('/');
    await expect(aPage.getByTestId('consent-banner')).toBeVisible();
    await aPage.getByTestId('consent-decline').click();
    await expect(aPage.getByTestId('consent-banner')).toHaveCount(0);
    // No wait needed to "let a leak land": a declined visitor's view is never sent (the beacon is
    // gated on consent === 'accepted', both in TrackVisit's install and in send() itself), so it
    // cannot arrive later. If that gate regressed, the poll below settles at +2, not +1, and fails.
    await decliner.dispose();

    // Visitor B accepts. Clicking accept must fire the beacon for THIS page view.
    const accepter = await openInteractiveVisitor(playwright);
    const bPage = await accepter.visit('/');
    await expect(bPage.getByTestId('consent-banner')).toBeVisible();
    const beacon = bPage.waitForRequest(
      (r) => r.url().includes('/api/v1/t') && r.method() === 'POST',
    );
    await bPage.getByTestId('consent-accept').click();
    await beacon;
    await expect(bPage.getByTestId('consent-banner')).toHaveCount(0);

    // Exactly one new index view: the accept recorded, the decline did not.
    await expect.poll(
      () => indexViews(request),
      { message: 'accept records exactly one view; decline records none', timeout: 15_000 },
    ).toBe(before + 1);

    await accepter.dispose();
  });

  test('once accepted, the banner does not ask again on the next page in the same browser', async (
    { playwright },
  ) => {
    const visitor = await openInteractiveVisitor(playwright);
    try {
      const first = await visitor.visit('/');
      await first.getByTestId('consent-accept').click();
      await expect(first.getByTestId('consent-banner')).toHaveCount(0);
      // A second navigation in the same browser (localStorage persists) is not re-asked.
      const second = await visitor.visit('/');
      await expect(second.getByTestId('consent-banner')).toHaveCount(0);
    } finally {
      await visitor.dispose();
    }
  });
});
