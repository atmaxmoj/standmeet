// connector-retry-invalid-grant-no-retry.spec.ts — §5 retry matrix · non-retryable
// errors don't get retried
//
// token refresh is sync (embedded in the call). Transient failures (network /
// 500) get a short retry budget — but invalid_grant is NON-RETRYABLE: the
// owner revoked access at Google, retrying can only fail again. Per §5 it
// must fail FAST to a friendly degrade, NOT burn the retry budget.
//
// invalid_grant → no retry → degrade: mock token endpoint returns invalid_grant; the book
// call degrades friendly AND the mock token endpoint is hit exactly ONCE (not
// N times) — proving the retry layer recognized a non-retryable error.
//
// Distinct from connector-revoked-degrades (which asserts the degrade) and
// connector-dep-drop-mid-turn (mid-turn drop): THIS one asserts the retry layer
// does NOT retry a non-retryable error — the hit-count is the load-bearing
// evidence.
//
// RED / TDD: until the retry layer's retryable-judgement excludes invalid_grant,
// a generic "retry on refresh failure" hits the token endpoint N times →
// count > 1 → assertion fails. Expected until the refactor lands.

import { execSync } from 'node:child_process';
import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { revokeMockGCalToken } from '@/fixtures/gcal';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const MOCK = process.env['MOCK_BASE_URL'] ?? 'http://localhost:9000';
const DB_CONTAINER = 'standmeet-dev-db-1';

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

// expireAccessToken —— force the GCal access_token expired so the book call
// must go through token refresh (which will hit the revoked token endpoint).
function expireAccessToken(): void {
  const sql = `UPDATE owner_connectors
              SET token_expires_at = NOW() - INTERVAL '1 hour'
              WHERE connector_id = 'google-calendar'`;
  execSync(`docker exec ${DB_CONTAINER} psql -U standmeet -d standmeet -c "${sql}"`,
    { stdio: 'pipe' });
}

// resetTokenCallCount —— zero the token-endpoint hit counter so the assertion counts
// only THIS test's refresh attempts. Control endpoints: POST /__mock/gcal/reset_token_count
// (reset) + GET /__mock/gcal/token_call_count (read) — mock-stack/job-board/main.go:238-239.
async function resetTokenCallCount(request: APIRequestContext): Promise<void> {
  await request.post(`${MOCK}/__mock/gcal/reset_token_count`);
}

async function getTokenCallCount(request: APIRequestContext): Promise<number> {
  const res = await request.get(`${MOCK}/__mock/gcal/token_call_count`);
  if (res.status() !== 200) throw new Error(`token_call_count: ${res.status()}`);
  const body = await res.json() as { count: number };
  return body.count;
}

async function callBook(
  request: APIRequestContext, convID: string, token: string,
): Promise<{ status: number; body: ToolResp }> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${convID}/tools/calendar_book`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: { topic: 'invalid_grant no-retry test', duration_min: 30, preferred_times: [future(7, 14)] },
    },
  );
  return { status: res.status(), body: await res.json() as ToolResp };
}

test.describe('connector retry · invalid_grant is non-retryable → fails fast, token endpoint hit once', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('refresh hits invalid_grant → NOT retried → friendly degrade + token endpoint hit count is 1',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();

      // arm: next refresh returns invalid_grant; access token looks expired so
      // the book call forces a refresh; reset the counter to isolate this turn.
      await revokeMockGCalToken(request);
      expireAccessToken();
      await resetTokenCallCount(request);

      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code: seed.code.code, visitor_name: 'V',
      });
      const { status, body } = await callBook(request, sess.conversation_id, sess.session_token);

      // friendly degrade — no crash, no raw invalid_grant / stack leaked.
      expect(status, 'no server crash').toBeLessThan(500);
      const msg = `${body.reason ?? ''} ${body.result?.error ?? ''}`;
      expect(msg, 'friendly reconnect hint')
        .toMatch(/calendar|reconnect|disconnect|unavailable/i);
      expect(msg, 'no raw stack / invalid_grant leak')
        .not.toMatch(/panic|goroutine|stack|invalid_grant/i);

      // the load-bearing assertion: invalid_grant was recognized as
      // non-retryable — the token endpoint was hit exactly once, not N times.
      const tokenCalls = await getTokenCallCount(request);
      expect(tokenCalls, 'invalid_grant not retried — endpoint hit exactly once').toBe(1);

      await request.dispose();
    });
});
