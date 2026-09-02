// connector-dep-disconnect-concurrent.spec.ts — fills a gap in the state-change matrix:
// "concurrent sessions · owner disconnects · both sessions lose the tool on their next turn".
//
// The global single-point gate is "the one entry point every visitor walks through" — its
// recompute of connector state is **an instance-wide cut**, not per-session. This test
// creates two independent visitor sessions (two browser contexts / two conversations),
// both with booking; after the owner disconnects the calendar, **both** sessions must
// lose calendar_book on their next turn — proving the single-point gate is not a
// per-session cache.
//
// RED: before the refactor lands, if gating self-checks per-session inside the booker cap
// and doesn't recompute per-turn, the two already-open sessions may keep seeing the tool
// -> the assertion fails, matching TDD expectations.

import { test } from '@/fixtures/test';
import type { Browser, BrowserContext } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { disconnectGCal } from '@/fixtures/gcal';
import { expectCalendarBookExposed } from '@/fixtures/agent-skills-grant';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

test.describe('connector dep · owner disconnect drops booking for ALL concurrent sessions', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('two separate sessions both have booking; owner disconnects → both lose it next turn',
    async ({ browser }) => {
      // Two independent visitors: different browser contexts, different members under
      // the same code (isolated by unique name).
      const a = await openVisitor(browser, seed, 'Alpha', 'alpha@example.com');
      const b = await openVisitor(browser, seed, 'Beta', 'beta@example.com');

      try {
        // Both sessions were assembled while connected -> both got calendar_book.
        await expectCalendarBookExposed(seed.request, a.sess.session_token, true);
        await expectCalendarBookExposed(seed.request, b.sess.session_token, true);

        // Owner disconnects the calendar (an instance-wide cut).
        await disconnectGCal(seed.request, seed.csrf);

        // Both sessions must lose the tool on their next turn (the single-point gate
        // recomputes globally, not per-session).
        await expectCalendarBookExposed(seed.request, a.sess.session_token, false);
        await expectCalendarBookExposed(seed.request, b.sess.session_token, false);
      } finally {
        await a.ctx.close();
        await b.ctx.close();
      }
    });
});

interface OpenedVisitor { ctx: BrowserContext; sess: VisitorSession }

// openVisitor — spins up an independent browser context + issues a code session under the
// same code with a unique name (a different member). Returns the context (for teardown) +
// the session.
async function openVisitor(
  browser: Browser, seed: CodedSeed, name: string, email: string,
): Promise<OpenedVisitor> {
  const ctx = await browser.newContext();
  const sess = await issueSession(seed.request, {
    handle: OWNER.handle, mode: 'code', code: seed.code.code,
    visitor_name: name, visitor_email: email,
  });
  return { ctx, sess };
}
