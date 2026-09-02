// connector-dep-reconnect-mid-session.spec.ts —— state-transition matrix:
// fills the "disconnected → reconnected · across two turns · next turn's tool
// reappears" cell.
//
// Mirrors disconnect-mid-session: starts disconnected (credentials configured
// but no OAuth) → booking hidden → owner completes OAuth and connects → next
// turn (freshly assembled) booking **reappears**. Verifies the single gate can
// both revoke and restore, and that per-turn recomputation also works in the
// "connect" direction.
//
// RED: before the refactor lands, per-turn recomputation / the global single
// gate don't exist → either the starting state is already computed wrong, or
// it fails to refresh after reconnect → the assertion fails, as expected under TDD.

import { test } from '@/fixtures/test';

import {
  seedOwnerCredentialed, teardownSeed, OWNER, type BaseSeed,
} from '@/fixtures/gcal-setup';
import {
  initGCalOAuth, getGCalStatus,
} from '@/fixtures/gcal';
import {
  issueCodeWithSkills, expectCalendarBookExposed,
} from '@/fixtures/agent-skills-grant';
import { issueSession } from '@/fixtures/visitor';

test.describe('connector dep · owner reconnect between turns reveals booking tool', () => {
  let seed: BaseSeed;
  test.beforeAll(async ({ playwright }) => {
    // Credentials are already saved, but OAuth hasn't run → connector not connected (refresh_token IS NULL).
    seed = await seedOwnerCredentialed(playwright);
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('disconnected → booking absent; owner completes OAuth → next session exposes booking',
    async () => {
      const code = await issueCodeWithSkills(seed.request, seed.csrf, {
        granted_skills: ['calendar.book'],
      });

      // turn 1 (not connected): calendar_book is absent from the tool-spec list.
      const before = await issueSession(seed.request, {
        handle: OWNER.handle, mode: 'code', code: code.code,
        visitor_name: 'Recruiter Rachel', visitor_email: 'rachel@example.com',
      });
      await expectCalendarBookExposed(seed.request, before.session_token, false);

      // Owner completes OAuth between the two turns → connector connects.
      const { auth_url } = await initGCalOAuth(seed.request, seed.csrf);
      const res = await seed.request.get(auth_url);
      if (res.status() !== 200) throw new Error(`oauth flow: ${res.status()}`);
      const status = await getGCalStatus(seed.request);
      if (!status.connected) throw new Error('reconnect: not connected after OAuth');

      // Next turn (freshly assembled): the single gate recomputes → Requires:[calendar] is satisfied → booking reappears.
      const after = await issueSession(seed.request, {
        handle: OWNER.handle, mode: 'code', code: code.code,
        visitor_name: 'Recruiter Rachel', visitor_email: 'rachel@example.com',
      });
      await expectCalendarBookExposed(seed.request, after.session_token, true);
    });
});
