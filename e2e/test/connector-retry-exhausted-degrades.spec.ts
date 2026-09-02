// connector-retry-exhausted-degrades.spec.ts —— §5 retry matrix · read-op exhaustion
//
// The retry budget is HARD-CAPPED (D-7: count cap + max backoff interval +
// total-time deadline ~10s — never unbounded). A PERSISTENT transient failure
// (every freeBusy attempt errors) must exhaust the budget and then degrade
// FRIENDLY — it must not retry forever, not 500, not leak a stack.
//
// Exhausted -> degrade: mock GCal fails freeBusy on EVERY attempt; after the bounded
// retries the tool returns a friendly degrade (status < 500, human-readable
// try-again hint, no panic/goroutine/stack/raw provider error).
//
// RED / TDD: until the per-op retry config + the friendly-degrade-on-exhaustion
// mapping land, a persistent failure either loops, 500s, or surfaces the raw
// provider error → assertion fails. Expected until the retry layer lands.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const MOCK = process.env['MOCK_BASE_URL'] ?? 'http://localhost:9000';

interface SlotsResp {
  ok?: boolean;
  reason?: string;
  result?: { error?: string; slots?: { start: string }[] };
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

// failFreeBusyAlways —— fail freeBusy on EVERY attempt (times:-1) so the failure
// outlasts the retry budget. Control endpoint: POST /__mock/gcal/fail
// { op:'freeBusy', status, times:-1 } (mock-stack/job-board/gcal.go).
async function failFreeBusyAlways(
  request: APIRequestContext, status = 503,
): Promise<void> {
  await request.post(`${MOCK}/__mock/gcal/fail`, {
    data: { op: 'freeBusy', status, times: -1 },
  });
}

async function callListSlots(
  request: APIRequestContext, convID: string, token: string,
): Promise<{ status: number; body: SlotsResp }> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${convID}/tools/calendar_list_slots`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        from_rfc3339: future(3, 13), until_rfc3339: future(5, 23),
        duration_min: 30, step_min: 60,
      },
    },
  );
  return { status: res.status(), body: await res.json() as SlotsResp };
}

test.describe('connector retry · persistent read failure exhausts budget → friendly degrade', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('every freeBusy attempt fails → retries exhausted → friendly degrade, no 500/stack',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await failFreeBusyAlways(request, 503);

      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code: seed.code.code, visitor_name: 'V',
      });
      const start = Date.now();
      const { status, body } = await callListSlots(
        request, sess.conversation_id, sess.session_token,
      );
      const elapsedMs = Date.now() - start;

      // bounded: total time stays under the hard deadline (D-7: ~10s cap; allow
      // generous slack for transport so the assertion isn't flaky, but it must
      // not loop forever).
      expect(elapsedMs, 'retry budget is time-capped, did not loop forever')
        .toBeLessThan(30_000);

      // graceful: never a server crash.
      expect(status, 'no server crash').toBeLessThan(500);
      const msg = `${body.reason ?? ''} ${body.result?.error ?? ''}`;
      expect(msg, 'friendly try-again hint after exhaustion')
        .toMatch(/again|later|unavailable|calendar|couldn'?t/i);
      expect(msg, 'no raw provider error / stack')
        .not.toMatch(/panic|goroutine|stack|5\d\d/i);

      await request.dispose();
    });
});
