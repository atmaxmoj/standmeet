// capability-disable-while-attached.spec.ts —— Phase H / P.6 corner：owner_enabled
// 门**优先于** role_acl 门。owner 关掉一个**仍挂在 role 上、且依赖已满足**的能力
// → 访客 session 里照样消失。证明 exposed = ... ∧ owner_enabled ∧ ... 里 enabled
// 是独立的一道闸，关了就拦，跟 ACL 授不授权无关。

import { test, expect } from '@/fixtures/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { issueSession } from '@/fixtures/visitor';
import { setCapabilityEnabled, sessionToolNames } from '@/fixtures/capabilities';

const BOOKING_ID = 'calendar.book';
const BOOKING_TOOL = 'calendar_book';

test.describe('Phase H · owner-disable beats ACL grant (P.6)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    // role grants calendar.book AND GCal is connected → both ACL + connector
    // gates are open; only owner_enabled remains to be tested.
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('disable calendar.book while a role still grants it → gone from the session',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: seed.code.code, visitor_name: 'V',
      });

      // baseline: ACL granted + connector connected → calendar_book exposed.
      expect(await sessionToolNames(request, sess.session_token))
        .toContain(BOOKING_TOOL);

      // owner disables the capability globally (even though the role still grants it).
      expect(await setCapabilityEnabled(request, seed.csrf, BOOKING_ID, false)).toBe(200);
      expect(await sessionToolNames(request, sess.session_token), 'disable beats ACL')
        .not.toContain(BOOKING_TOOL);

      // re-enable → ACL grant takes effect again.
      expect(await setCapabilityEnabled(request, seed.csrf, BOOKING_ID, true)).toBe(200);
      expect(await sessionToolNames(request, sess.session_token))
        .toContain(BOOKING_TOOL);

      await request.dispose();
    });
});
