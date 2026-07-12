// chat-book-token-refresh.spec.ts —— access token at insert time is past
// its expiry. Backend silently refreshes via Google's token endpoint,
// THEN inserts the event. Mock OAuth token endpoint is called twice
// (initial + refresh); mock GCal records exactly one event.

import { execSync } from 'node:child_process';
import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { getMockEvents } from '@/fixtures/gcal';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall, sendAndDrain } from '@/fixtures/mock-llm-script';

const MOCK = process.env['MOCK_BASE_URL'] ?? 'http://localhost:9000';
const DB_CONTAINER = 'standmeet-dev-db-1';

test.describe('chat · calendar.book refreshes expired access token', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('expired access token → backend refreshes silently → event inserted',
    async () => {
      expireAccessToken();                          // mutate DB directly
      const tag = await scriptMockToolCall(seed.request, {
        name: 'calendar_book',
        args: {
          topic: 'Refresh test',
          duration_min: 30,
          preferred_times: [future(7, 14)],
        },
      });
      await sendAndDrain(seed.request, seed.visitor, `Book${tag}`);
      const events = await getMockEvents(seed.request);
      expect(events).toHaveLength(1);
      const tokenCalls = await getMockTokenCallCount(seed.request);
      expect(tokenCalls).toBeGreaterThanOrEqual(2);     // initial + refresh
    });
});

// expireAccessToken —— force the first claimed owner's GCal access_token
// to look expired so the next BookMeeting triggers a refresh. Sentinel
// timestamp = epoch - 1h; backend's gcal refresher treats anything in
// the past as needing refresh. SQL is the cleanest knob — backend now
// has no dev-only HTTP endpoint for this (G-Y dropped /test/*).
function expireAccessToken(): void {
  const sql = `UPDATE owner_connectors
              SET token_expires_at = NOW() - INTERVAL '1 hour'
              WHERE connector_id = 'google-calendar'`;
  execSync(
    `docker exec ${DB_CONTAINER} psql -U standmeet -d standmeet -c "${sql}"`,
    { stdio: 'pipe' },
  );
}

async function getMockTokenCallCount(request: APIRequestContext): Promise<number> {
  const res = await request.get(`${MOCK}/__mock/gcal/token_call_count`);
  if (res.status() !== 200) throw new Error(`token_call_count: ${res.status()}`);
  const body = await res.json() as { count: number };
  return body.count;
}

async function prep(playwright: Playwright): Promise<CodedSeed> {
  return seedCodeVisitorOnConnectedOwner(playwright, {
    granted_skills: ['calendar.book'],
  });
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
