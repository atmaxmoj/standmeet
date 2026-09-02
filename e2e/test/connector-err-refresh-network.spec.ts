// connector-err-refresh-network.spec.ts -- §4 error-flow matrix E7
// token refresh hits a **network error / 500 (not invalid_grant)** -> friendly degrade.
// Distinct from connector-revoked-degrades: that one is invalid_grant (revoked -> stored
// as disconnected), this one is a **transient/network fault** -- the connection must not
// be declared dead, only degrade for this call.
//
// Error stream E7: token refresh fails with a NETWORK error / 500 (NOT
// invalid_grant) → friendly degrade, never a 500/stack. Distinct from
// connector-revoked-degrades (invalid_grant): a transient refresh fault must not
// be treated as a revoked connector.
//
// RED / TDD: goes green once token refresh handles network/500 separately from
// invalid_grant, each with its own friendly degrade.

import { execSync } from 'node:child_process';
import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

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

// expireAccessToken -- marks the owner's GCal access_token expired, forcing the next
// book call down the refresh path (same technique as connector-revoked-degrades).
function expireAccessToken(): void {
  const sql = `UPDATE owner_connectors
              SET token_expires_at = NOW() - INTERVAL '1 hour'
              WHERE connector_id = 'google-calendar'`;
  execSync(`docker exec ${DB_CONTAINER} psql -U standmeet -d standmeet -c "${sql}"`,
    { stdio: 'pipe' });
}

// failNextTokenRefresh —— arm an OAuth token-endpoint fault distinct from revoke
// (which returns invalid_grant). mode = 'network' (drop the connection) or '500'
// (server error body, NOT invalid_grant). Control endpoint: POST /__mock/gcal/token_fault
// (mock-stack/job-board/gcal.go).
async function failNextTokenRefresh(
  request: APIRequestContext, mode: 'network' | '500',
): Promise<void> {
  await request.post(`${MOCK}/__mock/gcal/token_fault`, {
    data: { mode, times: 1 },
  });
}

async function callBook(
  request: APIRequestContext, convID: string, token: string,
): Promise<{ status: number; body: ToolResp }> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${convID}/tools/calendar_book`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: { topic: 'E7 refresh network', duration_min: 30, preferred_times: [future(7, 14)] },
    },
  );
  return { status: res.status(), body: await res.json() as ToolResp };
}

test.describe('connector error stream · token refresh network/500 (not invalid_grant) degrades (E7)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('refresh hits a network error / 500 → friendly degrade, no 500, no invalid_grant leak',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await failNextTokenRefresh(request, 'network');
      expireAccessToken();   // force the refresh path

      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code: seed.code.code, visitor_name: 'V',
      });
      const { status, body } = await callBook(request, sess.conversation_id, sess.session_token);

      expect(status, 'no server crash').toBeLessThan(500);
      const msg = `${body.reason ?? ''} ${body.result?.error ?? ''}`;
      expect(msg, 'friendly try-again / reconnect hint')
        .toMatch(/calendar|reconnect|unavailable|again|later|couldn'?t/i);
      // a transient network/500 fault must not surface a stack — and must NOT be
      // mislabeled as a revocation (that's the invalid_grant path, a different test).
      expect(msg, 'no raw stack / invalid_grant mislabel')
        .not.toMatch(/panic|goroutine|stack|invalid_grant/i);

      await request.dispose();
    });
});
