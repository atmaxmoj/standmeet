// admin-gcal-authorize-ui.spec.ts —— F-B-2 regression guard.
//
// Real-env verification found "Authorize on Google" in CalendarConnectorPanel
// POSTed to /api/admin/connectors/google-calendar/init → 404 (the backend
// serves no /init route; the OAuth-start endpoint is /connect). Google
// Calendar could not be connected from the UI at all.
//
// Why CI missed it: the API-level gcal fixtures (initGCalOAuth) POST directly
// to the correct /connect endpoint, and connector-assemble-from-ui clicks the
// *generic* catalog card's Connect (also /connect). No spec ever clicked the
// dedicated CalendarConnectorPanel's Authorize button, so its /init path 404'd
// unnoticed. This drives the ACTUAL button and asserts it hits /connect.

import { test, expect } from '@/fixtures/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { saveGCalCredentials, resetMockGCal, MOCK_GCAL_CREDS } from '@/fixtures/gcal';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('admin · GCal Authorize button hits the real connect endpoint (F-B-2)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await login(request, OWNER.email, OWNER.password);
    await resetMockGCal(request);
    // Credentials saved but NOT authorized → the panel shows "Authorize".
    await saveGCalCredentials(request, csrf, MOCK_GCAL_CREDS);
    await request.dispose();
  });

  test('clicking "Authorize on Google" POSTs /connect (not a 404 /init)',
    async ({ adminPage: page }) => {
      await page.getByTestId('admin-nav-connectors').click();
      const authorize = page.getByTestId('gcal-authorize');
      await expect(authorize).toBeVisible({ timeout: 10_000 });
      // The button must POST the real OAuth-start endpoint and get 200. On the
      // old code it POSTed /init → 404 and this waitForResponse would time out.
      const connect = page.waitForResponse(
        (r) => r.url().includes('/api/admin/connectors/google-calendar/connect')
          && r.request().method() === 'POST',
        { timeout: 15_000 });
      await authorize.click();
      const res = await connect;
      expect(res.status(), 'authorize must POST /connect → 200, not /init → 404').toBe(200);
    });
});
