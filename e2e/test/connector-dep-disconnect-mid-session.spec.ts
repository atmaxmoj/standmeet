// connector-dep-disconnect-mid-session.spec.ts -- fills in the state-transition matrix row
// "connected -> disconnected (owner disconnect) - between two turns - next turn hides the
// tool (single gate recomputes)".
//
// Now that connector gating routes through the global single gate `enabledCaps`, connector
// connection state gets recomputed on **every session assembly (per-turn)**. This test
// verifies: a code visitor on an already-connected owner sees calendar_book exposed on turn
// 1; the owner disconnects the calendar between turns; the next turn **must no longer show**
// the tool (checked both by issuing a new session's tool-spec list, and by the AI being
// unable to call it mid-chat).
//
// RED: before the refactor lands, gating went through a hardcoded Connected() self-check
// inside the booker cap and did not recompute per-turn -> the tool would still be there ->
// this assertion fails, as TDD expects.

import { test } from '@/fixtures/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { disconnectGCal } from '@/fixtures/gcal';
import { expectCalendarBookExposed } from '@/fixtures/agent-skills-grant';
import { issueSession } from '@/fixtures/visitor';

test.describe('connector dep · owner disconnect between turns hides booking tool', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('connected → booking exposed; owner disconnects → next session has no booking tool',
    async () => {
      // Turn 1 (already connected at assembly time): calendar_book is in the tool-spec list.
      await expectCalendarBookExposed(seed.request, seed.visitor.session_token, true);

      // Owner disconnects the calendar connection between the two turns.
      await disconnectGCal(seed.request, seed.csrf);

      // Next turn = a fresh session assembled anew. The single gate recomputes connector
      // state -> every cap with Requires:[calendar] (including booker) gets kicked out of
      // enabledCaps -> hidden.
      const next = await issueSession(seed.request, {
        handle: OWNER.handle, mode: 'code', code: seed.code.code,
        visitor_name: 'Recruiter Rachel', visitor_email: 'rachel@example.com',
      });
      await expectCalendarBookExposed(seed.request, next.session_token, false);

      // The next turn on the same old session should also no longer see the tool (per-turn recompute, not per-session).
      await expectCalendarBookExposed(seed.request, seed.visitor.session_token, false);
    });
});
