// connector-retry-insert-idempotent.spec.ts —— §五 重试矩阵 · 写类不双订
//
// events.insert is a SYNC, NON-IDEMPOTENT write. Blind retries double-book.
// Per the locked design (§五 写幂等): only retry on a "connection failed
// BEFORE send" or with an idempotency key — never blindly. So under a
// TRANSIENT connection error around events.insert the booking must still
// succeed AND create EXACTLY ONE event (no double-book).
//
// 重试下不双订: mock GCal injects a transient connection error around
// events.insert; after the retry exactly ONE event exists (getMockEvents
// length === 1).
//
// RED / TDD: until events.insert retry is gated on pre-send connection failure
// / carries an idempotency key, a naive retry creates two events → length 2 →
// assertion fails. Expected until the idempotent-write retry lands.

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
  ok?: boolean;
  reason?: string;
  result?: { error?: string };
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

// flakeEventsInsertOnce —— inject a transient CONNECTION error around events.insert
// exactly ONCE. The mock is honest about whether the write landed server-side, so the
// retry path can be checked for double-create. Control endpoint: POST /__mock/gcal/fail
//   { op:'events.insert', mode:'connreset-after-write'|'connreset-before-write', times:1 }
// 'connreset-after-write' is the dangerous case: server got the write but the
// client saw a connection error → a blind retry double-books.
async function flakeEventsInsertOnce(
  request: APIRequestContext, mode = 'connreset-after-write',
): Promise<void> {
  await request.post(`${MOCK}/__mock/gcal/fail`, {
    data: { op: 'events.insert', mode, times: 1 },
  });
}

async function callBook(
  request: APIRequestContext, convID: string, token: string,
): Promise<{ status: number; body: ToolResp }> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${convID}/tools/calendar_book`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: { topic: 'Idempotent insert test', duration_min: 30, preferred_times: [future(7, 14)] },
    },
  );
  return { status: res.status(), body: await res.json() as ToolResp };
}

test.describe('connector retry · events.insert under transient connection error does not double-book', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('connection error around events.insert is retried → exactly ONE event exists',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await flakeEventsInsertOnce(request, 'connreset-after-write');

      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code: seed.code.code, visitor_name: 'V',
      });
      const { status } = await callBook(request, sess.conversation_id, sess.session_token);

      // never a server crash regardless of how the retry resolves.
      expect(status, 'no server crash').toBeLessThan(500);

      // the load-bearing assertion: exactly one event, never two.
      const events = await getMockEvents(request);
      expect(events, 'idempotent write — no double-book under retry').toHaveLength(1);

      await request.dispose();
    });
});
