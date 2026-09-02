// connector-err-google-5xx.spec.ts — §4 E6
// A code visitor with calendar connected; mock Google `events.insert` returns
// 500/429/timeout → the tool call degrades gracefully (status<500, no
// panic/goroutine/stack), the AI suggests trying again, and no event is created.
//
// RED / TDD: goes green once the connector proxy maps Google 5xx to a graceful
// degradation.
//
// Error stream E6: when mock Google events.insert returns a server error, the
// booking tool degrades to a friendly message instead of crashing — no 500,
// no stack leak, no event created.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { getMockEvents } from '@/fixtures/gcal';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const MOCK = process.env['MOCK_BASE_URL'] ?? 'http://localhost:9000';

interface ToolResp {
  ok: boolean;
  reason?: string;
  result?: { error?: string };
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

// failNextEventsInsert —— arm the gcal mock so the next events.insert returns `status`.
// Control endpoint: POST /__mock/gcal/fail { op, status } (mock-stack/job-board/gcal.go).
async function failNextEventsInsert(
  request: APIRequestContext, status = 500,
): Promise<void> {
  await request.post(`${MOCK}/__mock/gcal/fail`, {
    data: { op: 'events.insert', status },
  });
}

async function callBook(
  request: APIRequestContext, convID: string, token: string,
): Promise<{ status: number; body: ToolResp }> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${convID}/tools/calendar_book`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: { topic: 'E6 google 5xx', duration_min: 30, preferred_times: [future(7, 14)] },
    },
  );
  return { status: res.status(), body: await res.json() as ToolResp };
}

test.describe('connector error stream · Google events.insert 5xx degrades (E6)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('events.insert returns 500 → friendly try-again, no 500, no stack, no event',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await failNextEventsInsert(request, 500);

      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code: seed.code.code, visitor_name: 'V',
      });
      const { status, body } = await callBook(request, sess.conversation_id, sess.session_token);

      // graceful: never a server crash.
      expect(status, 'no server crash').toBeLessThan(500);
      const msg = `${body.reason ?? ''} ${body.result?.error ?? ''}`;
      expect(msg, 'friendly try-again hint')
        .toMatch(/again|later|unavailable|calendar|couldn'?t/i);
      expect(msg, 'no raw provider error / stack')
        .not.toMatch(/panic|goroutine|stack|5\d\d/i);

      // no event was created.
      const events = await getMockEvents(request);
      expect(events).toHaveLength(0);

      await request.dispose();
    });
});

async function prep(playwright: Playwright): Promise<CodedSeed> {
  return seedCodeVisitorOnConnectedOwner(playwright, {
    granted_skills: ['calendar.book'],
  });
}
