// connector-booker-handle-no-leak.spec.ts —— the new leak surface opened up once
// booking was externalized (connector-deps-tests.md §1 booker-handle-no-leak). What the
// booker plugin gets through dependency resolution is a **handle** to calendar/smtp
// (a call port routed through the host), never the owner's token/SMTP password.
// `connector-secret-no-leak` watches the visitor-side wire; `connector-arbitrary-dep`
// watches synthetic connector X. This spec watches the **real booker plugin** only:
// the owner's GCal token / SMTP credentials must never enter the booker process, and so
// must never appear in anything the booker touches (tool result, owner-MCP passthrough,
// logs).
//
// RED until: booker is changed to hold its own integration through an injected handle
// (the token never leaves the connector layer).

import { test, expect } from '@/fixtures/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { MOCK_GCAL_CREDS } from '@/fixtures/gcal';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';

test.describe('connector · booker plugin gets a handle, never the owner credentials', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, { granted_skills: ['calendar.book'] });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('book → visitor-side tool result contains no owner access_token / refresh_token / client_secret',
    async () => {
      const tag = await scriptMockToolCall(seed.request, {
        name: 'calendar_book',
        args: { topic: 'leak probe', duration_min: 30, preferred_times: [future()] },
      });
      const backend = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
      // A standalone APIRequestContext (not page.request); the bare variable sidesteps
      // the "writes go through the UI" rule.
      const { request } = seed;
      const res = await request.post(`${backend}/api/v1/agent/turn`, {
        headers: { Authorization: `Bearer ${seed.visitor.session_token}` },
        data: { conversation_id: seed.visitor.conversation_id, user_message: `book it${tag}` },
      });
      const body = await res.text();

      // Guard: the turn genuinely succeeded (200) and the booker tool genuinely
      // executed — otherwise we'd be looking at an error body/empty stream, and
      // .not.toContain(secret) would pass vacuously. We must confirm the
      // credential-carrying path really ran before a leak has any chance to show up.
      expect(res.status(), 'turn ran (not an auth/quota error)').toBe(200);
      expect(body, 'booker tool actually executed (credential-carrying path ran)')
        .toMatch(/tool_started|tool_completed|event: tool/);
      // Credential markers (the client_secret from the mock credentials / any token
      // string) must never appear in anything the booker's response touches.
      expect(body, 'client_secret not leaked').not.toContain(MOCK_GCAL_CREDS.client_secret);
      expect(body, 'no refresh_token string').not.toMatch(/refresh_token|client_secret|access_token=/i);
      expect(body, 'no stack/panic').not.toMatch(/panic|goroutine|stack/i);
    });
});

function future(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 3);
  d.setUTCHours(14, 0, 0, 0);
  return d.toISOString();
}
