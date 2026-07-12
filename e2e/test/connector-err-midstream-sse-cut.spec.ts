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

// cutTurnAfterToolStarted —— **真·客户端中断**(不是假的 mock 开关):用 Node 原生 fetch
// 流式读 /agent/turn 的 SSE,一看到 `event: tool_started` 帧就 AbortController.abort() —— 这
// 正是访客浏览器在工具执行途中断线/关页的真实攻击面,后端会在 tool 进行中收到 r.Context()
// 取消。返 abort 前已收到的原始 SSE(供断言查:确进了 tool 阶段、没吐 stack、没走到 done)。
async function cutTurnAfterToolStarted(
  token: string, convID: string, msg: string,
): Promise<string> {
  const ctrl = new AbortController();
  let raw = '';
  try {
    // 例外:必须用原生 fetch —— 要**流式**读 SSE + mid-flight abort 模拟客户端断线;
    // Playwright 的 request fixture 会缓冲整段响应,做不到中途掐断。
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
        ctrl.abort(); // 客户端在工具执行途中断线
        break;
      }
    }
  } catch (e) {
    // abort() → fetch/reader 抛 AbortError,这是我们主动断线的预期结果,吞掉;其余 rethrow。
    if (!(e instanceof Error) || e.name !== 'AbortError') throw e;
  }
  return raw;
}

// fetchTurnRaw —— 恢复轮:正常跑完一轮 /agent/turn,拿 status + 完整 SSE。
async function fetchTurnRaw(
  request: APIRequestContext, token: string, convID: string, msg: string,
): Promise<{ status: number; raw: string }> {
  const res = await request.post(`${BACKEND}/api/v1/agent/turn`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { system: '', user_message: msg, conversation_id: convID, history: [] },
  });
  return { status: res.status(), raw: await res.text() };
}

// fetchConversation —— 读回这条对话(真公开路由 GET /conversations/{id};/transcript 只在
// admin 面,访客侧没有)。用来断言中断轮没把对话弄脏:仍可读(200)、无半截 panic/stack。
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

      // 客户端在 tool_started 之后断线(真实 mid-tool cut)。
      const raw = await cutTurnAfterToolStarted(
        sess.session_token, sess.conversation_id, `book me next week${tag1}`,
      );

      // 断言 cut 真落在 tool 阶段:进了 tool_started,但没读到 done(连接被我们提前掐了)。
      expect(raw, 'cut actually reached the tool phase').toContain('event: tool_started');
      expect(raw, 'cut happened before the turn finished streaming').not.toContain('event: done');
      // 中断不是 server crash,也不能把 stack 吐进流。
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

      // 对话没被中断轮弄脏:真读回 /conversations/{id} —— 仍可读(200)、无半截 panic/stack。
      const convo = await fetchConversation(request, sess.session_token, sess.conversation_id);
      expect(convo.status, 'conversation still readable after the cut').toBe(200);
      expect(convo.body, 'conversation not left dirty by the cut').not.toMatch(/panic|goroutine|stack/i);

      await request.dispose();
    });
});
