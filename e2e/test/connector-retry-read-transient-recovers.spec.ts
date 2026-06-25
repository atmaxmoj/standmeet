// connector-retry-read-transient-recovers.spec.ts —— §五 重试矩阵 · 读类
//
// freeBusy / calendar_list_slots is a SYNC, IDEMPOTENT read. Per D-7 it gets a
// small retry budget (3 attempts, 1s/2s/4s backoff, ~10s total cap). A
// TRANSIENT error (one 503/timeout) followed by success must be invisible to
// the visitor: the retry layer absorbs it and the visitor still gets slots.
//
// 瞬时错→重→成功: mock GCal fails freeBusy ONCE then succeeds; the tool returns
// slots (status 200, no user-visible failure, no degrade message).
//
// RED / TDD: until the per-op retry config (on top of the #132 generic retry
// infra) wraps the read class, the first transient error surfaces as a degrade
// → assertion fails. Expected until the retry layer lands.

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
  slots?: { start: string }[];
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

// TODO(impl): needs a mock fault toggle that fails freeBusy/list_slots a BOUNDED
// number of times then recovers (transient). No setMockGCalFailure helper exists
// yet — raw POST so the spec compiles. Backend mock endpoint to add with the
// refactor: { op, status, times } → fail the next `times` calls with `status`,
// then serve normally.
async function failFreeBusyTransiently(
  request: APIRequestContext, times = 1, status = 503,
): Promise<void> {
  await request.post(`${MOCK}/__mock/gcal/fail`, {
    data: { op: 'freeBusy', status, times },
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

test.describe('connector retry · transient read error recovers (visitor still gets slots)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('freeBusy fails once then succeeds → retry absorbs it → slots returned, no degrade',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await failFreeBusyTransiently(request, 1, 503);

      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code: seed.code.code, visitor_name: 'V',
      });
      const { status, body } = await callListSlots(
        request, sess.conversation_id, sess.session_token,
      );

      // visitor sees success — the single transient failure was retried away.
      expect(status, 'no user-visible failure').toBe(200);
      const slots = body.result?.slots ?? body.slots ?? [];
      expect(slots.length, 'slots returned after retry').toBeGreaterThan(0);

      // no degrade message leaked into the result.
      const msg = `${body.reason ?? ''} ${body.result?.error ?? ''}`;
      expect(msg, 'no degrade text on a recovered read')
        .not.toMatch(/unavailable|try again|couldn'?t|failed/i);

      await request.dispose();
    });
});
