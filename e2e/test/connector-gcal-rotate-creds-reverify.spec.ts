// connector-gcal-rotate-creds-reverify.spec.ts -- §III row D-5:
// "changing an identity field: calendar swaps client_id/secret" (edit-config) -> clears
// the token (refresh_token=NULL) -> connected=false -> the booking tool is hidden -> only
// re-running OAuth restores it.
//
// RED / TDD: depends on the connector dependency-resolution refactor + the "identity
// field changed -> re-verify" logic landing before this goes green.
// Currently, saveGCalCredentials's second write doesn't clear the token; this spec
// expects connected to flip to false.
//
// Identity-field change re-verify (decision D-5): rotating GCal client_id/secret
// is an identity change → backend MUST clear the refresh token → status flips to
// connected=false → calendar_book is hidden until the owner re-runs OAuth.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import {
  saveGCalCredentials, getGCalStatus, type GCalCredentials,
} from '@/fixtures/gcal';
import {
  seedOwnerGCalConnected, teardownSeed, type BaseSeed,
} from '@/fixtures/gcal-setup';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { issueSession } from '@/fixtures/visitor';
import { expectCalendarBookExposed } from '@/fixtures/agent-skills-grant';
import { OWNER } from '@/fixtures/gcal-setup';

// A set of credentials different from the default MOCK_GCAL_CREDS -- simulates the owner
// switching Google projects.
const ROTATED_CREDS: GCalCredentials = {
  client_id: 'mock-gcal-client-id-ROTATED',
  client_secret: 'mock-gcal-client-secret-ROTATED',
};

test.describe('connector · GCal rotate credentials → re-verify (§3 D-5)', () => {
  let seed: BaseSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('connected → save NEW client_id/secret → connected flips false, booking hidden',
    async () => {
      // precondition: fully connected.
      const before = await getGCalStatus(seed.request);
      expect(before.connected).toBe(true);

      // owner rotates the OAuth client identity → must reset the connection.
      await saveGCalCredentials(seed.request, seed.csrf, ROTATED_CREDS);

      const after = await getGCalStatus(seed.request);
      // identity change cleared the refresh token → no longer connected.
      expect(after.connected).toBe(false);
      // credentials themselves are present (the new ones), it's the token that's gone.
      expect(after.has_credentials).toBe(true);

      // gate side: the booking tool must drop out of the assembled spec for a
      // fresh session (single-point gate recomputes connector state).
      const code = await issueCodeWithSkills(seed.request, seed.csrf, {
        granted_skills: ['calendar.book'],
      });
      const sess = await issueSession(seed.request, {
        handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'V',
      });
      await expectCalendarBookExposed(seed.request, sess.session_token, false);
    });
});

async function prep(playwright: Playwright): Promise<BaseSeed> {
  return seedOwnerGCalConnected(playwright);
}
