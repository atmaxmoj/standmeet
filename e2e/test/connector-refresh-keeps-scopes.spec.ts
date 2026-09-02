// connector-refresh-keeps-scopes.spec.ts -- F-C-43: **a silent refresh must not wipe out
// already-granted scopes.**
//
// Why this matters now, and not before: after F-B-8, the `scopes` on a connection row is
// **load-bearing** -- assembly compares it against each action's required scope, and
// drops that tool when it doesn't reach. So "scopes goes empty after a refresh" is no
// longer just a row of dirty data -- it's **the visitor's booking silently vanishing an
// hour after the owner connected**, while the card still says `connected`.
//
// The repro condition is spelled out in the spec: RFC 6749 §5.1 -- the token response's
// `scope` field **may be omitted** when the granted scope is the same as what was
// requested. Google echoes it back, so real environments never hit this path; the stand-
// in used to always echo it back too, being more polite than the spec, so the product had
// never been asked "what do you treat the granted scope as when it's omitted"
// ([[stand-in-is-politer-than-reality]]).
// Teach the stand-in to follow the rules first (`?outcome=refresh_omit_scope`), then let
// the guard go red, then fix the product.
//
// The criterion isn't "scopes is non-empty" but "**identical, verbatim, to before the
// refresh**": the former would still pass green if the product swapped it for some other
// constant. And the final line, "the tool is still there", is what this defect actually
// damages -- if the data is right but the capability didn't come back, the two lines
// before it are a hollow green.

import { execSync } from 'node:child_process';
import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { sessionToolNames } from '@/fixtures/capabilities';
import { grantedScopes } from '@/fixtures/gcal';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall, sendAndDrain } from '@/fixtures/mock-llm-script';

const MOCK = process.env['MOCK_BASE_URL'] ?? 'http://localhost:9000';
const DB_CONTAINER = 'standmeet-dev-db-1';

test.describe('F-C-43 · a silent refresh keeps the granted scopes', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
    });
  });
  test.afterAll(async () => {
    await programOAuth(seed.request, '');
    await teardownSeed(seed);
  });

  test('the provider omits scope on refresh; the connection keeps what it was granted',
    async () => {
      test.setTimeout(120_000);
      const before = await grantedScopes(seed.request);
      expect(before.length,
        'the seed must start with a real grant, or this test proves nothing')
        .toBeGreaterThan(0);

      await programOAuth(seed.request, 'refresh_omit_scope');
      expireAccessToken();

      // Trigger a real call that needs the calendar for the refresh to actually happen --
      // this is exactly the moment that, to the owner, looks like nothing happened at all.
      const tag = await scriptMockToolCall(seed.request, {
        name: 'calendar_book',
        args: { topic: 'Scope survival', duration_min: 30, preferred_times: [future(7, 14)] },
      });
      await sendAndDrain(seed.request, seed.visitor, `Book${tag}`);

      const after = await grantedScopes(seed.request);
      expect(after,
        'a refresh that says nothing about scope is not a refresh that revoked it')
        .toEqual(before);

      const tools = await sessionToolNames(seed.request, seed.visitor.session_token);
      expect(tools,
        'and the visitor still gets booking — losing it here would be invisible to the owner')
        .toContain('calendar_book');
    });
});

async function programOAuth(request: APIRequestContext, outcome: string): Promise<void> {
  const res = await request.get(`${MOCK}/__mock/oauth/program?outcome=${outcome}`);
  if (res.status() !== 200) throw new Error(`program oauth: ${res.status()}`);
}

// expireAccessToken -- pushes the access token's expiry into the past, so the next call
// that needs the calendar triggers a silent refresh.
// Uses the same knob as chat-book-token-refresh (the backend has no dev-only clock
// endpoint).
function expireAccessToken(): void {
  const sql = `UPDATE owner_connectors
              SET token_expires_at = NOW() - INTERVAL '1 hour'
              WHERE connector_id = 'google-calendar'`;
  execSync(
    `docker exec ${DB_CONTAINER} psql -U standmeet -d standmeet -c "${sql}"`,
    { stdio: 'pipe' },
  );
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
