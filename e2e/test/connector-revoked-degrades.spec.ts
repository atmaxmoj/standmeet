// connector-revoked-degrades.spec.ts — Phase B: a connector is revoked (the owner
// revoked authorization on the Google side) → the next refresh gets invalid_grant →
// the backend recognizes "the connector is dead" and **degrades gracefully**, no
// crash, no leaked stack trace. chat-book-token-refresh covers the "expired → refresh
// succeeds" half; this covers the "refresh fails (revoked) → degrades" half.
//
// Trigger: revoke the mock token endpoint + mark access_token as expired (forcing the
// refresh path) → the refresh is rejected → the visitor's booking attempt gets a
// friendly error (suggesting reconnecting the calendar), not an HTTP 500.

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

// expireAccessToken — marks the owner's GCal access_token as expired, forcing the
// next book onto the refresh path (the refresh will hit the already-revoked token
// endpoint).
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
      data: { topic: 'Revoked test', duration_min: 30, preferred_times: [future(7, 14)] },
    },
  );
  return { status: res.status(), body: await res.json() as ToolResp };
}

test.describe('Phase B · revoked connector degrades gracefully', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('refresh hits invalid_grant → booking returns a friendly error, never a 500',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await revokeMockGCalToken(request);   // next refresh → invalid_grant
      expireAccessToken();                  // force the refresh path

      const sess = await issueSession(request, {
        handle: OWNER.handle, code: seed.code.code, visitor_name: 'V',
      });
      const { status, body } = await callBook(request, sess.conversation_id, sess.session_token);

      // graceful: not a 500, and the visitor gets a human-readable hint, not a stack trace.
      expect(status, 'no server crash').toBeLessThan(500);
      const msg = `${body.reason ?? ''} ${body.result?.error ?? ''}`;
      expect(msg, 'friendly reconnect hint').toMatch(/calendar|reconnect|disconnect|unavailable/i);
      expect(msg, 'no raw stack trace').not.toMatch(/panic|goroutine|invalid_grant/i);

      await request.dispose();
    });
});
