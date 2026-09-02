// connector-err-midstream-sse-cut.spec.ts — §4 error-stream matrix, E15.
// A connector-backed tool call's stream is interrupted **while it's in progress** (inside the
// SSE stream) → **recoverable**, the transcript **is not left dirty**, no crash. Call chain:
// the agent/turn SSE stream cuts after tool_started but before tool_completed → the
// backend/frontend must resolve this turn into a clean, recoverable state (not a half-formed
// dirty frame, not a 500, not a panic).
//
// Error stream E15: the SSE stream is interrupted DURING a connector-backed tool
// call → recoverable, the transcript is not left dirty, no crash.
//
// RED / TDD: depends on the agent/turn stream resolving to a clean recoverable state on a
// mid-tool SSE cut being implemented before this goes green.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

// cutTurnAfterToolStarted — **a genuine client-side disconnect** (not a fake mock toggle): uses
// Node's native fetch to stream-read the /agent/turn SSE, and calls AbortController.abort() the
// moment it sees an `event: tool_started` frame — this is exactly the real attack surface of a
// visitor's browser disconnecting/closing the tab mid-tool-execution, and the backend receives
// r.Context() cancellation while the tool is still in flight. Returns the raw SSE received before
// the abort (for assertions to check: it genuinely reached the tool phase, emitted no stack, and
// never reached done).
async function cutTurnAfterToolStarted(
  token: string, convID: string, msg: string,
): Promise<string> {
  const ctrl = new AbortController();
  let raw = '';
  try {
    // Exception: native fetch is required here — reading the SSE **as a stream** plus a
    // mid-flight abort is what simulates a client disconnect; Playwright's request fixture
    // buffers the whole response and can't be cut off partway through.
    /* eslint-disable no-restricted-syntax */
    const res = await fetch(`${BACKEND}/api/v1/agent/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ system: '', user_message: msg, conversation_id: convID, history: [] }),
      signal: ctrl.signal,
    });
    /* eslint-enable no-restricted-syntax */
    if (res.body === null) return raw;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      raw += dec.decode(value, { stream: true });
      if (raw.includes('event: tool_started')) {
        ctrl.abort(); // the client disconnects mid-tool-execution
        break;
      }
    }
  } catch (e) {
    // abort() → fetch/reader throws AbortError, which is the expected result of us disconnecting
    // on purpose — swallow it; rethrow anything else.
    if (!(e instanceof Error) || e.name !== 'AbortError') throw e;
  }
  return raw;
}

// fetchTurnRaw — the recovery turn: runs one normal /agent/turn to completion, getting the
// status + the full SSE.
async function fetchTurnRaw(
  request: APIRequestContext, token: string, convID: string, msg: string,
): Promise<{ status: number; raw: string }> {
  const res = await request.post(`${BACKEND}/api/v1/agent/turn`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { system: '', user_message: msg, conversation_id: convID, history: [] },
  });
  return { status: res.status(), raw: await res.text() };
}

// fetchConversation — reads the conversation back (the real public route GET
// /conversations/{id}; /transcript only exists on the admin side, not for visitors). Used to
// assert the cut turn didn't leave the conversation dirty: still readable (200), no half-formed
// panic/stack.
async function fetchConversation(
  request: APIRequestContext, token: string, convID: string,
): Promise<{ status: number; body: string }> {
  const res = await request.get(
    `${BACKEND}/api/v1/conversations/${convID}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return { status: res.status(), body: await res.text() };
}

test.describe('connector error stream · mid-stream SSE cut during connector-backed tool call (E15)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('SSE cut during calendar_book stream → recoverable, transcript not dirty, no crash',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code: seed.code.code, visitor_name: 'V',
      });

      const tag1 = await scriptMockToolCall(request, {
        name: 'calendar_book',
        args: { topic: 'E15 sse cut', duration_min: 30, preferred_times: [future(7, 14)] },
      });

      // The client disconnects right after tool_started (a genuine mid-tool cut).
      const raw = await cutTurnAfterToolStarted(
        sess.session_token, sess.conversation_id, `book me next week${tag1}`,
      );

      // Assert the cut genuinely landed in the tool phase: reached tool_started, but never saw
      // done (we cut the connection off before that).
      expect(raw, 'cut actually reached the tool phase').toContain('event: tool_started');
      expect(raw, 'cut happened before the turn finished streaming').not.toContain('event: done');
      // The interruption must not be a server crash, and must not leak a stack into the stream.
      expect(raw, 'no raw stack in stream').not.toMatch(/panic|goroutine|stack/i);

      // recoverable: the next turn on the SAME conversation still works (not wedged).
      const tag2 = await scriptMockToolCall(request, {
        name: 'calendar_book',
        args: { topic: 'E15 recover', duration_min: 30, preferred_times: [future(8, 14)] },
      });
      const next = await fetchTurnRaw(
        request, sess.session_token, sess.conversation_id, `try again please${tag2}`,
      );
      expect(next.status, 'conversation recovers after the cut').toBeLessThan(500);
      expect(next.raw, 'no stack on recovery turn').not.toMatch(/panic|goroutine|stack/i);

      // The conversation isn't left dirty by the cut turn: read it back for real via
      // /conversations/{id} — still readable (200), no half-formed panic/stack.
      const convo = await fetchConversation(request, sess.session_token, sess.conversation_id);
      expect(convo.status, 'conversation still readable after the cut').toBe(200);
      expect(convo.body, 'conversation not left dirty by the cut').not.toMatch(/panic|goroutine|stack/i);

      await request.dispose();
    });
});
