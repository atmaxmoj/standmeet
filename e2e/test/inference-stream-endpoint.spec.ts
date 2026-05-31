// inference-stream-endpoint.spec.ts —— POST /api/v1/inference/stream
// 是 browser pi-agent-core 的 LLM single-turn 出口。本 spec 验：
//   - happy: 无 tools，发 user message → SSE 流出 text deltas + done(end_turn)
//   - tool surfacing: 带 corpus tools，messages 没 tool_result → done
//     (tool_use) + tool_call event 为 corpus_search
//   - 异常: no Bearer → 401
//   - 异常: bad token → 401
//   - 异常: invalid JSON body → 400

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';
import type { VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'stream@example.com', password: 'correct-horse-battery-staple',
  handle: 'stream', fullName: 'Stream Owner',
};

const CODE = 'STREAM-001';

interface ParsedSSE {
  events: { type: string; data: unknown }[];
}

async function setupStreamOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const role = await createRole(request, csrf, {
    name: 'stream-role', description: 'inference-stream spec',
    corpus_uris: ['wiki://**', 'output://**'],
  });
  await createCode(request, csrf, {
    code: CODE, label: 'stream', assumed_role_id: role.id,
  });
  await request.dispose();
}

async function postStream(
  request: APIRequestContext, sess: VisitorSession, body: object,
): Promise<{ status: number; sse: ParsedSSE }> {
  const res = await request.post(`${BACKEND}/api/v1/inference/stream`, {
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

test.describe('inference stream endpoint · single-turn SSE forwarder', () => {
  test.beforeAll(async ({ playwright }) => {
    await setupStreamOwner(playwright);
  });

  test('plain user message (no tools) → text deltas + done(end_turn)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'V',
      });
      const { status, sse } = await postStream(request, sess, {
        system: 'You are alice.',
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(status).toBe(200);
      // 至少一个 text + 最后是 done(end_turn)
      const textEvents = sse.events.filter(e => e.type === 'text');
      expect(textEvents.length, 'has text deltas').toBeGreaterThan(0);
      const last = sse.events.at(-1);
      expect(last?.type).toBe('done');
      const lastData = last?.data as { stop_reason?: string };
      expect(lastData?.stop_reason).toBe('end_turn');
      await request.dispose();
    });

  test('with corpus tools + no tool_result yet → tool_call corpus_search + done(tool_use)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'V',
      });
      const { status, sse } = await postStream(request, sess, {
        system: 'You are alice.',
        messages: [{ role: 'user', content: 'tell me about lucerna' }],
        tools: [
          { name: 'corpus_search', description: 'search',
            input_schema: { type: 'object', properties: { query: { type: 'string' } } } },
          { name: 'corpus_read', description: 'read',
            input_schema: { type: 'object', properties: { path: { type: 'string' } } } },
        ],
      });
      expect(status).toBe(200);
      const toolCall = sse.events.find(e => e.type === 'tool_call');
      expect(toolCall, 'tool_call event present').toBeDefined();
      const callData = toolCall?.data as { name?: string; input?: unknown };
      expect(callData?.name).toBe('corpus_search');
      const last = sse.events.at(-1);
      expect(last?.type).toBe('done');
      expect((last?.data as { stop_reason?: string }).stop_reason).toBe('tool_use');
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

async function assertMissingAuth401(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${BACKEND}/api/v1/inference/stream`, {
    data: { system: '', messages: [] },
  });
  expect(res.status()).toBe(401);
}

async function assertBadBearer401(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${BACKEND}/api/v1/inference/stream`, {
    headers: { Authorization: 'Bearer smv_bogus' },
    data: { system: '', messages: [] },
  });
  expect(res.status()).toBe(401);
}

async function assertInvalidBody400(request: APIRequestContext): Promise<void> {
  const sess = await issueSession(request, {
    handle: OWNER.handle, code: CODE, visitor_name: 'V',
  });
  const res = await request.post(`${BACKEND}/api/v1/inference/stream`, {
    headers: {
      Authorization: `Bearer ${sess.session_token}`,
      'Content-Type': 'application/json',
    },
    data: '{not json',
  });
  expect(res.status()).toBe(400);
}
