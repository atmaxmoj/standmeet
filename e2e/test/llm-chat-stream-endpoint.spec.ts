// llm-chat-stream-endpoint.spec.ts -- H.2: the new chat entry point
// POST /api/v1/llm/chat/stream, which goes through eino model.ToolCallingChatModel.
// The browser's pi-agent-core switches to this in H.5; the old /inference/stream byte
// proxy gets deleted in H.3.
//
// Verifies:
//   - happy: no tools, sends a user message -> at least 1 text frame + a done frame with
//     stop_reason=end_turn
//   - tool surfacing: with a corpus_search tool, and the mock gateway script injects a
//     calendar_book tool_call -> a tool_call frame + a done frame with
//     stop_reason=tool_use
//   - error: no Bearer -> 401
//   - error: bad token -> 401
//   - error: invalid JSON body -> 400

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createRole } from '@/fixtures/roles';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { issueSession } from '@/fixtures/visitor';
import type { VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'llmchat@example.com', password: 'correct-horse-battery-staple',
  handle: 'llmchat', fullName: 'LLM Chat Owner',
};

const CODE = 'LLMCHAT-001';

interface ParsedSSE {
  events: { type: string; data: unknown }[];
}

async function setupLLMChatOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const role = await createRole(request, csrf, {
    name: 'llmchat-role', description: 'llm chat spec',
    corpus_uris: ['wiki://**', 'output://**'],
  });
  await createCode(request, csrf, {
    code: CODE, label: 'llmchat', assumed_role_id: role.id,
  });
  await request.dispose();
}

async function postLLMChat(
  request: APIRequestContext, sess: VisitorSession, body: object,
): Promise<{ status: number; sse: ParsedSSE }> {
  const res = await request.post(`${BACKEND}/api/v1/llm/chat/stream`, {
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

test.describe('llm chat stream endpoint · eino-backed unified SSE', () => {
  test.beforeAll(async ({ playwright }) => {
    await setupLLMChatOwner(playwright);
  });

  test('plain user message (no tools) → text + done(end_turn)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await assertPlainTurn(request);
      await request.dispose();
    });

  test('with tool offered + scripted tool_call → tool_call + done(tool_use)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await assertToolUseTurn(request);
      await request.dispose();
    });

  test('missing Authorization → 401',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await assertMissingAuth401(request);
      await request.dispose();
    });

  test('bad bearer → 401',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await assertBadBearer401(request);
      await request.dispose();
    });

  test('invalid JSON body → 400',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await assertInvalidBody400(request);
      await request.dispose();
    });
});

async function assertPlainTurn(request: APIRequestContext): Promise<void> {
  const sess = await issueSession(request, {
    handle: OWNER.handle, code: CODE, visitor_name: 'V',
  });
  const { status, sse } = await postLLMChat(request, sess, {
    system: 'You are alice.',
    messages: [{ role: 'user', content: 'hi' }],
  });
  expect(status).toBe(200);
  const textFrames = sse.events.filter((e) => e.type === 'text');
  expect(textFrames.length, 'has text deltas').toBeGreaterThan(0);
  const doneFrame = sse.events.find((e) => e.type === 'done');
  expect(doneFrame, 'has done frame').toBeDefined();
  const doneData = doneFrame?.data as { stop_reason?: string };
  expect(doneData?.stop_reason).toBe('end_turn');
}

async function assertToolUseTurn(request: APIRequestContext): Promise<void> {
  const sess = await issueSession(request, {
    handle: OWNER.handle, code: CODE, visitor_name: 'V',
  });
  // Force the upstream mock gateway to emit a tool_use for corpus_search.
  const tag = await scriptMockToolCall(request, {
    name: 'corpus_search',
    args: { query: 'alice' },
  });
  const { status, sse } = await postLLMChat(request, sess, {
    system: 'You are alice.',
    messages: [{ role: 'user', content: `tell me about alice${tag}` }],
    tools: [
      {
        name: 'corpus_search',
        description: 'search the owner corpus',
        input_schema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    ],
  });
  expect(status).toBe(200);
  const toolCall = sse.events.find((e) => e.type === 'tool_call');
  expect(toolCall, 'tool_call frame present').toBeDefined();
  const callData = toolCall?.data as { name?: string };
  expect(callData?.name).toBe('corpus_search');
  const doneFrame = sse.events.find((e) => e.type === 'done');
  const doneData = doneFrame?.data as { stop_reason?: string };
  expect(doneData?.stop_reason).toBe('tool_use');
}

async function assertMissingAuth401(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${BACKEND}/api/v1/llm/chat/stream`, {
    data: { system: '', messages: [] },
  });
  expect(res.status()).toBe(401);
}

async function assertBadBearer401(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${BACKEND}/api/v1/llm/chat/stream`, {
    headers: { Authorization: 'Bearer smv_bogus' },
    data: { system: '', messages: [] },
  });
  expect(res.status()).toBe(401);
}

async function assertInvalidBody400(request: APIRequestContext): Promise<void> {
  const sess = await issueSession(request, {
    handle: OWNER.handle, code: CODE, visitor_name: 'V',
  });
  const res = await request.post(`${BACKEND}/api/v1/llm/chat/stream`, {
    headers: {
      Authorization: `Bearer ${sess.session_token}`,
      'Content-Type': 'application/json',
    },
    data: '{not json',
  });
  expect(res.status()).toBe(400);
}
