// capability-dependency-greyed.spec.ts —— Phase H / P.6：可用性的「connector 依赖」
// 门。能力面板每行透出它依赖的 connector 状态 —— calendar.book 需 Google
// Calendar，未连 → 行显「需要 Google Calendar — 未连」(dependency.connected=false)。
// 连上 → 变 true。这跟 chat-book-not-connected（访客侧隐藏）是同一门的 admin 视图。

import { test, expect } from '@/fixtures/test';

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

test.describe('Phase H · capability connector-dependency status (P.6)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    ({ csrf } = await loginAPI(request, OWNER.email, OWNER.password));
    await request.dispose();
  });

  test('calendar.book row: dependency Google Calendar, not connected → connected after OAuth',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();

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

      await request.dispose();
    });
});
