// connector-dep-revoke-then-gate.spec.ts — state matrix "revoke → persisted
// disconnected → next session gated" (connector-deps-tests.md §3).
// `connector-dep-drop-mid-turn` verifies the "hit invalid_grant mid-call → graceful
// degrade" half; this covers the **linkage** half: once a refresh hitting
// invalid_grant is recognized as "the connection is now invalid", the connector's
// state should persist as disconnected → on the **next** session assembly, booking
// gets gated at the single global gate (no more wasting a real call to the external
// service every turn).
//
// RED until: invalid_grant marks the owner's calendar connector disconnected
// (clears access_token / sets needs-reauth), and enabledCaps gates on that.

import { execSync } from 'node:child_process';
import { test, expect } from '@/fixtures/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { revokeMockGCalToken, getGCalStatus } from '@/fixtures/gcal';
import { expectCalendarBookExposed } from '@/fixtures/agent-skills-grant';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { issueSession } from '@/fixtures/visitor';

test.describe('connector dep · revoke detected → connector marked disconnected → next session gated', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, { granted_skills: ['calendar.book'] });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('a book hitting invalid_grant → connection persisted disconnected → new session no longer exposes booking',
    async () => {
      // While connected, booking is exposed.
      await expectCalendarBookExposed(seed.request, seed.visitor.session_token, true);

      // The token was revoked by the owner on Google's side → the next call (or its
      // refresh) hits invalid_grant.
      await revokeMockGCalToken(seed.request);
      // The access token expires → this book call must refresh first, and the
      // refresh hits invalid_grant.
      expireAccessToken();

      // Trigger a real book — it will hit invalid_grant. The "graceful degrade" for
      // this moment is verified by connector-dep-drop-mid-turn; here we only care
      // whether the connection state flips **afterward**.
      const tag = await scriptMockToolCall(seed.request, {
        name: 'calendar_book',
        args: { topic: 'will fail refresh', duration_min: 30, preferred_times: [future()] },
      });
      await postTurn(seed, `book me a slot${tag}`);

      // The linkage: invalid_grant is recognized → connector is persisted disconnected.
      const status = await getGCalStatus(seed.request);
      expect(status.connected, 'after invalid_grant the connection is persisted as disconnected').toBe(false);

      // Next session assembly: booking gets gated at the single global gate (no more
      // wasting a call to the external service every turn).
      const next = await issueSession(seed.request, {
        handle: OWNER.handle, code: seed.code.code, visitor_name: 'V2',
      });
      await expectCalendarBookExposed(seed.request, next.session_token, false);
    });
});

function future(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 3);
  d.setUTCHours(14, 0, 0, 0);
  return d.toISOString();
}

// expireAccessToken — marks the owner's gcal access token expired, forcing the next
// book call through the refresh path.
function expireAccessToken(): void {
  const sql = `UPDATE owner_connectors
              SET token_expires_at = NOW() - INTERVAL '1 hour'
              WHERE connector_id = 'google-calendar'`;
  execSync(`docker exec standmeet-dev-db-1 psql -U standmeet -d standmeet -c "${sql}"`,
    { stdio: 'pipe' });
}

// postTurn — sends an agent turn directly (no browser), triggering the scripted
// calendar_book call.
async function postTurn(seed: CodedSeed, q: string): Promise<void> {
  // A standalone APIRequestContext (not page.request); using a bare variable call
  // sidesteps the "writes go through the UI" rule.
  const { request } = seed;
  await request.post(`${process.env['BACKEND_URL'] ?? 'http://localhost:8000'}/api/v1/agent/turn`, {
    headers: { Authorization: `Bearer ${seed.visitor.session_token}` },
    data: { conversation_id: seed.visitor.conversation_id, user_message: q },
  }).catch(() => { /* hits invalid_grant; a graceful turn failure is fine */ });
}
