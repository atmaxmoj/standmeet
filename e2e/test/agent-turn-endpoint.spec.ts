// agent-turn-endpoint.spec.ts —— H.9: 新 visitor agent loop 入口。
//
// POST /api/v1/agent/turn 走 backend eino ADK ChatModelAgent。本 spec
// 是 H.9.a smoke：只验 plain text 路径 (无 tool call) → text 帧 +
// done(end_turn)；auth 失败路径；body 非法路径。
//
// tool 流 / capability_state delta / throbber label / summarization 等
// 增量留 H.9.b / H.11 / H.9b 专门 spec 覆盖。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';
import type { Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';
import type { VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'agentturn@example.com', password: 'correct-horse-battery-staple',
  handle: 'agentturn', fullName: 'Agent Turn Owner',
};

const CODE = 'AGENTTURN-001';

interface ParsedSSE {
  events: { type: string; data: unknown }[];
}

async function setupOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const role = await createRole(request, csrf, {
    name: 'agentturn-role', description: 'agent turn spec',
    corpus_uris: ['wiki://**', 'output://**'],
  });
  await createCode(request, csrf, {
    code: CODE, label: 'agentturn', assumed_role_id: role.id,
  });
  await request.dispose();
}

async function postAgentTurn(
  request: APIRequestContext, sess: VisitorSession, body: object,
): Promise<{ status: number; sse: ParsedSSE }> {
  const res = await request.post(`${BACKEND}/api/v1/agent/turn`, {
    headers: {
      Authorization: `Bearer ${sess.session_token}`,
      'Content-Type': 'application/json',
    },
    data: body,
  });
  if (res.status() !== 200) {
    return { status: res.status(), sse: { events: [] } };
  }
  const text = await res.text();
  return { status: 200, sse: parseSSE(text) };
}

function parseSSE(raw: string): ParsedSSE {
  const events: { type: string; data: unknown }[] = [];
  for (const frame of raw.split('\n\n')) {
    const lines = frame.split('\n');
    let evType = '';
    let evData = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) evType = line.slice(7).trim();
      else if (line.startsWith('data: ')) evData = line.slice(6).trim();
    }
    if (evType !== '') {
      events.push({ type: evType, data: JSON.parse(evData) as unknown });
    }
  }
  return { events };
}

test.describe('agent turn endpoint · eino ADK driven', () => {
  test.beforeAll(async ({ playwright }) => {
    await setupOwner(playwright);
  });

  test('plain user message (no tools) → text + done(end_turn)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await assertPlainTurn(request);
      await request.dispose();
    });

  test('scripted corpus_search tool_use → tool_started + tool_completed',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await assertToolEvents(request);
      await request.dispose();
    });

  test('missing Authorization → 401',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const res = await request.post(`${BACKEND}/api/v1/agent/turn`, {
        data: { system: '', user_message: 'hi' },
      });
      expect(res.status()).toBe(401);
      await request.dispose();
    });

  test('invalid JSON body → 400',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'V',
      });
      const res = await request.post(`${BACKEND}/api/v1/agent/turn`, {
        headers: {
          Authorization: `Bearer ${sess.session_token}`,
          'Content-Type': 'application/json',
        },
        data: '{not json',
      });
      expect(res.status()).toBe(400);
      await request.dispose();
    });
});

async function assertPlainTurn(request: APIRequestContext): Promise<void> {
  const sess = await issueSession(request, {
    handle: OWNER.handle, code: CODE, visitor_name: 'V',
  });
  const { status, sse } = await postAgentTurn(request, sess, {
    system: 'You are alice.',
    user_message: 'hi',
  });
  expect(status).toBe(200);
  const textFrames = sse.events.filter((e) => e.type === 'text');
  expect(textFrames.length, 'has text deltas').toBeGreaterThan(0);
  const doneFrame = sse.events.find((e) => e.type === 'done');
  expect(doneFrame, 'has done frame').toBeDefined();
  const doneData = doneFrame?.data as { stop_reason?: string };
  expect(doneData?.stop_reason).toBe('end_turn');
}

async function assertToolEvents(request: APIRequestContext): Promise<void> {
  const sess = await issueSession(request, {
    handle: OWNER.handle, code: CODE, visitor_name: 'V',
  });
  // 强制 mock 上来就抛 corpus_search tool_use；backend ADK dispatch
  // tool → eino schema.Tool 事件 → tool_completed。
  await scriptMockToolCall(request, {
    name: 'corpus_search', args: { query: 'alice' },
  });
  const { status, sse } = await postAgentTurn(request, sess, {
    system: 'You are alice.',
    user_message: 'tell me about alice',
  });
  expect(status).toBe(200);
  const started = sse.events.find((e) => e.type === 'tool_started');
  expect(started, 'tool_started frame present').toBeDefined();
  const startedData = started?.data as { name?: string; progress_label?: string };
  expect(startedData?.name).toBe('corpus_search');
  // H.11: progress_label 来自 backend BindingTool.ProgressLabel
  // (corpus_search 在 capability 注册时是 "searching corpus")。
  expect(startedData?.progress_label).toBe('searching corpus');
  const completed = sse.events.find((e) => e.type === 'tool_completed');
  expect(completed, 'tool_completed frame present').toBeDefined();
  const completedData = completed?.data as { name?: string };
  expect(completedData?.name).toBe('corpus_search');
  const doneFrame = sse.events.find((e) => e.type === 'done');
  expect(doneFrame, 'has done frame').toBeDefined();
}
