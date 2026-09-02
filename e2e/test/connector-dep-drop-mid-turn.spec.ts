// connector-dep-drop-mid-turn.spec.ts -- fills in the state-transition matrix cell
// "connected -> disconnected · mid-call (tool list already sent, connection already
// dropped by call time) · friendly degrade, no 500/stack" (also maps to error-flow matrix
// E7, the "connection drops the instant of the call" class of token-refresh failure).
//
// Shaped just like connector-revoked-degrades: still connected at assembly time (the tool
// made it into the list sent to the LLM), but the connection drops before calendar_book
// actually executes -- here, revokeMockGCalToken makes that call's token refresh hit
// invalid_grant. Expected: the tool call **degrades gracefully** (hints at reconnecting
// the calendar), never a 500, and never leaks stack / panic / the raw invalid_grant text.
//
// RED: if the connector-backed tool's error-mapping/degradation path isn't unified before
// the refactor lands, it may 500 outright or leak the provider's raw error -> the
// assertion fails, as expected under TDD.

import { execSync } from 'node:child_process';
import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { revokeMockGCalToken } from '@/fixtures/gcal';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const DB_CONTAINER = 'standmeet-dev-db-1';

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

// expireAccessToken -- marks the owner's GCal access_token as expired, forcing book down
// the refresh path (which then hits the already-revoked token endpoint).
function expireAccessToken(): void {
  // The connector refactor generalised the per-category tables into one `owner_connectors`
  // (connector_id / category / token_expires_at); `owner_calendar_connectors.provider` is gone.
  // Guard the row count: a WHERE that matches nothing would still exit 0, leaving this helper
  // silently doing nothing and the assertion failing somewhere far away.
  const sql = `UPDATE owner_connectors
              SET token_expires_at = NOW() - INTERVAL '1 hour'
              WHERE connector_id = 'google-calendar'`;
  const out = execSync(
    `docker exec ${DB_CONTAINER} psql -U standmeet -d standmeet -c "${sql}"`,
    { stdio: 'pipe' },
  ).toString();
  if (out.includes('UPDATE 0')) {
    throw new Error(`expireAccessToken matched no connector row: ${out.trim()}`);
  }
}

async function callBook(
  request: APIRequestContext, convID: string, token: string,
): Promise<{ status: number; body: ToolResp }> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${convID}/tools/calendar_book`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: { topic: 'Mid-turn drop test', duration_min: 30, preferred_times: [future(7, 14)] },
    },
  );
  return { status: res.status(), body: await res.json() as ToolResp };
}

test.describe('connector dep · connection drops mid-turn → friendly degrade', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('tool was exposed at assembly but connection drops before the book call → no 500, no leak',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();

      // Still connected at assembly time -> the tool makes it into this turn's list. The
      // connection then drops before the call (revoke + force a refresh).
      await revokeMockGCalToken(request);
      expireAccessToken();

      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code: seed.code.code,
        visitor_name: 'Recruiter Rachel', visitor_email: 'rachel@example.com',
      });
      const { status, body } = await callBook(request, sess.conversation_id, sess.session_token);

      // Friendly degrade: not a 500, gives a human-readable hint (reconnect the
      // calendar), doesn't leak the underlying details.
      expect(status, 'no server crash').toBeLessThan(500);
      const msg = `${body.reason ?? ''} ${body.result?.error ?? ''}`;
      expect(msg, 'friendly reconnect hint')
        .toMatch(/calendar|reconnect|disconnect|unavailable/i);
      expect(msg, 'no raw stack / leak')
        .not.toMatch(/panic|goroutine|stack|invalid_grant/i);

      await request.dispose();
    });
});
