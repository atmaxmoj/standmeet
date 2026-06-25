// connector-err-midstream-sse-cut.spec.ts —— §四 错误流矩阵 E15
// connector-backed tool call **进行中**(SSE 流里)流被中断 → **可恢复**、transcript
// **不脏**、不崩。链路:agent/turn SSE 在 tool_started 之后、tool_completed 之前断 →
// 后端/前端把这轮收成一个干净的可恢复状态(非半截脏帧、非 500、非 panic)。
//
// Error stream E15: the SSE stream is interrupted DURING a connector-backed tool
// call → recoverable, the transcript is not left dirty, no crash.
//
// RED / TDD：依赖 agent/turn 流在 mid-tool SSE 断裂时收成干净可恢复状态落地后转绿。

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

// TODO(impl): needs a mid-stream SSE-cut fault toggle — no helper exists yet.
// Raw POST so the spec COMPILES; backend control endpoint to add with the
// refactor: cut the /agent/turn SSE connection once, AFTER a tool_started frame
// for a connector-backed tool but BEFORE tool_completed.
async function cutNextStreamMidTool(request: APIRequestContext): Promise<void> {
  await request.post(`${BACKEND}/__mock/agent/sse_cut`, {
    data: { at: 'mid-tool', times: 1 },
  });
}

// fetchTurnRaw —— drive one /agent/turn directly so we can inspect the raw SSE
// stream after the cut (status + body), rather than the drained-text helper.
async function fetchTurnRaw(
  request: APIRequestContext, token: string, convID: string, msg: string,
): Promise<{ status: number; raw: string }> {
  const res = await request.post(`${BACKEND}/api/v1/agent/turn`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { system: '', user_message: msg, conversation_id: convID, history: [] },
  });
  return { status: res.status(), raw: await res.text() };
}

// fetchTranscript —— pull the conversation transcript so we can assert it isn't
// left dirty (no half-written / panic markers) after the cut.
async function fetchTranscript(
  request: APIRequestContext, token: string, convID: string,
): Promise<string> {
  const res = await request.get(
    `${BACKEND}/api/v1/conversations/${convID}/transcript`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return res.status() === 200 ? await res.text() : '';
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

      await scriptMockToolCall(request, {
        name: 'calendar_book',
        args: { topic: 'E15 sse cut', duration_min: 30, preferred_times: [future(7, 14)] },
      });
      await cutNextStreamMidTool(request);

      const { status, raw } = await fetchTurnRaw(
        request, sess.session_token, sess.conversation_id, 'book me next week',
      );

      // a mid-stream cut is not a server crash, and must not spill a stack into the stream.
      expect(status, 'no server crash').toBeLessThan(500);
      expect(raw, 'no raw stack in stream').not.toMatch(/panic|goroutine|stack/i);

      // recoverable: the next turn on the SAME conversation still works (not wedged).
      await scriptMockToolCall(request, {
        name: 'calendar_book',
        args: { topic: 'E15 recover', duration_min: 30, preferred_times: [future(8, 14)] },
      });
      const next = await fetchTurnRaw(
        request, sess.session_token, sess.conversation_id, 'try again please',
      );
      expect(next.status, 'conversation recovers after the cut').toBeLessThan(500);
      expect(next.raw, 'no stack on recovery turn').not.toMatch(/panic|goroutine|stack/i);

      // transcript is not left dirty by the interrupted turn.
      const transcript = await fetchTranscript(request, sess.session_token, sess.conversation_id);
      expect(transcript, 'transcript not left dirty').not.toMatch(/panic|goroutine|stack/i);

      await request.dispose();
    });
});
