// connector-dep-half-config.spec.ts —— fills in the state-transition matrix cell "credentials
// saved, not authorized (no refresh_token) · assembled · Connected=false → hidden"
// (the half-config boundary).
//
// The owner has stored GCal client_id/secret but **never completed OAuth** (no
// refresh_token). The connected predicate must be false → the booker cap that Requires:
// [calendar] does not enter enabledCaps → the calendar_book tool is **absent** from the
// session tool-spec. Half-configured is not the same as connected.
//
// Note: this shares a starting point with chat-book-not-connected (seedOwnerCredentialed),
// but that test asserts from "visitor holds the grant but owner isn't connected"; this one
// specifically targets the lifecycle cell "credentials stored / refresh_token IS NULL" —
// a boundary case that fills in the connector-deps matrix.
//
// RED: before the refactor lands, if the connected predicate only checks has_credentials and
// not refresh_token, a half-config will be misjudged as connected → the tool gets exposed by
// mistake → the assertion fails, as expected under TDD.

import { test, expect } from '@/fixtures/test';

import {
  seedOwnerCredentialed, teardownSeed, OWNER, type BaseSeed,
} from '@/fixtures/gcal-setup';
import { getGCalStatus } from '@/fixtures/gcal';
import {
  issueCodeWithSkills, expectCalendarBookExposed,
} from '@/fixtures/agent-skills-grant';
import { issueSession } from '@/fixtures/visitor';

test.describe('connector dep · credentials saved but OAuth never completed → booking hidden', () => {
  let seed: BaseSeed;
  test.beforeAll(async ({ playwright }) => {
    // saveGCalCredentials ran, but **without** initGCalOAuth/callback → no refresh_token.
    seed = await seedOwnerCredentialed(playwright);
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('has_credentials true but connected false → calendar_book absent from session',
    async () => {
      // Precondition: half-configured = credentials present, not connected.
      const status = await getGCalStatus(seed.request);
      expect(status.has_credentials, 'credentials were saved').toBe(true);
      expect(status.connected, 'but OAuth never completed → not connected').toBe(false);

      const code = await issueCodeWithSkills(seed.request, seed.csrf, {
        granted_skills: ['calendar.book'],
      });
      const visitor = await issueSession(seed.request, {
        handle: OWNER.handle, mode: 'code', code: code.code,
        visitor_name: 'Recruiter Rachel', visitor_email: 'rachel@example.com',
      });

      // connected predicate false → even though the code grants calendar.book, the tool
      // must still be hidden.
      await expectCalendarBookExposed(seed.request, visitor.session_token, false);
    });
});
