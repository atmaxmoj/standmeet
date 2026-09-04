// capability-dependency-greyed.spec.ts —— Phase H / P.6: the availability "connector
// dependency" gate. Each row of the capability panel surfaces the status of the connector
// it depends on —— calendar.book needs Google Calendar; when not connected → the row shows
// "needs Google Calendar — not connected" (dependency.connected=false). Once connected →
// it flips to true. This is the admin-side view of the same gate as chat-book-not-connected
// (which hides it on the visitor side).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import {
  saveGCalCredentials, initGCalOAuth, MOCK_GCAL_CREDS,
} from '@/fixtures/gcal';
import { findCapability } from '@/fixtures/capabilities';

const OWNER = {
  email: 'cap-dep@example.com', password: 'correct-horse-battery-staple',
  handle: 'capdep', fullName: 'Cap Dep Owner',
};

const BOOKING_ID = 'calendar.book';

let csrf = '';
let admin: APIRequestContext;

test.describe('Phase H · capability connector-dependency status (P.6)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    admin = await playwright.request.newContext();
    const request = admin;
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    ({ csrf } = await loginAPI(request, OWNER.email, OWNER.password));
  });

  test.afterAll(async () => { await admin?.dispose(); });

  test('calendar.book row: dependency Google Calendar, not connected → connected after OAuth',
    async () => {
      const request = admin;

      // before connecting: dependency present + unmet.
      const before = await findCapability(request, csrf, BOOKING_ID);
      expect(before, 'calendar.book listed').toBeDefined();
      expect(before?.dependency?.name).toMatch(/google calendar/i);
      expect(before?.dependency?.connected, 'unmet before connect').toBe(false);

      // connect GCal (save creds + complete the mock OAuth).
      await saveGCalCredentials(request, csrf, MOCK_GCAL_CREDS);
      const { auth_url } = await initGCalOAuth(request, csrf);
      await request.get(auth_url);

      // after connecting: dependency met.
      const after = await findCapability(request, csrf, BOOKING_ID);
      expect(after?.dependency?.connected, 'met after connect').toBe(true);

    });
});
