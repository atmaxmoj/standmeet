// connector-secret-no-leak.spec.ts —— Phase B / secret-scan: a connector credential must
// **never** appear in anything the visitor can see. Booking / listing slots goes through the
// GCal connector (which holds the secret and calls on the owner's behalf), but the owner's
// client_secret / token value must never appear in a tool_result or in the admin
// conversation transcript.
//
// This pairs with connector-credential-arch (the go-arch-lint structural gate) to pincer
// "credentials never leave the vault" from both sides: structurally, capability code can't
// touch credentials; behaviorally, credentials don't leak. Must stay green both before and
// after any refactor (this is a regression guard, not a new contract — so it should already
// be green now).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// gcal-setup uses MOCK_GCAL_CREDS (client_secret is a known constant). This value is the
// owner's credential and must never leak to the visitor side.
const GCAL_CLIENT_SECRET = 'mock-gcal-client-secret';

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

async function callListSlots(
  request: APIRequestContext, convID: string, token: string,
): Promise<{ status: number; text: string }> {
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
  return { status: res.status(), text: await res.text() };
}

// callBook —— goes through the externalized booker plugin's terminal op (calendar_book). The
// plugin is called over a narrow socket; the GCal credential is injected server-side by the
// connector proxy and **never** crosses the plugin boundary — assert the secret doesn't end
// up in the booked result.
async function callBook(
  request: APIRequestContext, convID: string, token: string,
): Promise<{ status: number; text: string }> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${convID}/tools/calendar_book`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: { topic: 'Secret-scan booker probe', duration_min: 30, preferred_times: [future(4, 14)] },
    },
  );
  return { status: res.status(), text: await res.text() };
}

// fetchTranscript —— reads the full transcript of that conversation from the owner admin's
// view (tool calls + results are both persisted here, so a leaked secret would show up).
// **Must use the owner-authed seed.request**: a visitor context hitting the admin route only
// gets a 401, and that error body naturally contains no secret → not.toContain would be
// vacuously true (a false green). Returns status too, so the assertion can gate on it.
async function fetchTranscript(
  ownerRequest: APIRequestContext, csrf: string, convID: string,
): Promise<{ status: number; text: string }> {
  const res = await ownerRequest.get(`${BACKEND}/api/admin/conversations/${convID}`, {
    headers: { 'X-Csrftoken': csrf },
  });
  return { status: res.status(), text: await res.text() };
}

test.describe('Phase B · connector credential never leaks to the visitor', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('calendar_list_slots goes through the GCal connector but never echoes the secret',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: seed.code.code, visitor_name: 'V',
      });

      // exercises the connector (FreeBusy via the stored token).
      const { status, text } = await callListSlots(request, sess.conversation_id, sess.session_token);
      expect(status).toBe(200);
      // the owner credential value must NOT appear in the visitor-facing tool result.
      expect(text, 'secret not in tool_result').not.toContain(GCAL_CLIENT_SECRET);

      // #142 fold: the secret must NOT reach the externalized booker plugin either — calendar_book
      // is the plugin's terminal op (InsertEvent via the stored token, injected server-side). The
      // plugin sees only the op args, never the credential. Pin 200 so a friendly-error body can't
      // sneak the assertion past (that would be secret-free by construction → false green).
      const booked = await callBook(request, sess.conversation_id, sess.session_token);
      expect(booked.status, 'booker plugin op really ran (not an error body)').toBe(200);
      expect(booked.text, 'secret not in booker plugin result').not.toContain(GCAL_CLIENT_SECRET);

      // nor in the admin transcript of that conversation (tool calls + results are persisted).
      // Read the transcript back for real, using owner-authed seed.request; pin the status to
      // 200 first, so a 401 error body can't sneak the assertion through.
      const transcript = await fetchTranscript(seed.request, seed.csrf, sess.conversation_id);
      expect(transcript.status, 'transcript really fetched (not a 401 body)').toBe(200);
      expect(transcript.text, 'secret not in transcript').not.toContain(GCAL_CLIENT_SECRET);

      await request.dispose();
    });
});
