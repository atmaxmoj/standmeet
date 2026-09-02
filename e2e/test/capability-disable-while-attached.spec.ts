// capability-disable-while-attached.spec.ts —— Phase H / P.6 corner: the owner_enabled gate
// **takes priority over** the role_acl gate. When the owner turns off a capability that is
// **still attached to a role and still has its dependencies satisfied**, it still disappears
// from the visitor session. This proves that in exposed = ... ∧ owner_enabled ∧ ..., the
// enabled term is an independent gate — turning it off blocks regardless of whether the ACL grants it.

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
    async () => {
      const request = seed.request;
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

    });
});
