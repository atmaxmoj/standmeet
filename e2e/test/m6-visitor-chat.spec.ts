import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';

// M6 DoD：admin 创建 access code → visitor 拿 code 颁发 session → POST 消息
// 拿到 SSE 流（token events + done event），消息落库，scope 过滤生效。
//
// 走 mock provider（INFERENCE_PROVIDER=mock + INFERENCE_MOCK_REPLY 注入），
// 不调真 LLM，断言固定 reply 抵达。

const COMPOSE = '-f ../docker-compose.dev.yml -p standmeet-dev';
const PASSWORD = 'correct-horse-battery-staple';
const MOCK_REPLY = 'Hello visitor, sijie says hi from the mock provider.';

function resetInstance(): void {
  execSync(`docker compose ${COMPOSE} down -v`, { stdio: 'inherit' });
  execSync(`docker compose ${COMPOSE} up -d --wait`, { stdio: 'inherit' });
}

function findSetupToken(): string {
  const logs = execSync(`docker compose ${COMPOSE} logs backend --no-color`).toString();
  const m = logs.match(/setup\?t=([\w-]+)/);
  if (!m) throw new Error('setup token not found');
  return m[1];
}

interface MCPResponse {
  jsonrpc: string;
  id?: number | string;
  result?: any;
  error?: { code: number; message: string };
}

async function mcpCall(
  request: any,
  body: any,
  bearer: string,
  sessionId?: string,
): Promise<{ status: number; sessionId: string | null; body: MCPResponse | null }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${bearer}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  const res = await request.post('/mcp', { headers, data: body });
  const sid = res.headers()['mcp-session-id'] ?? null;
  const text = await res.text();
  let parsed: MCPResponse | null = null;
  if (text.trim().startsWith('{')) parsed = JSON.parse(text);
  else if (text.includes('data:')) {
    const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
    if (dataLine) parsed = JSON.parse(dataLine.slice(5).trim());
  }
  return { status: res.status(), sessionId: sid, body: parsed };
}

async function initMCP(request: any, bearer: string): Promise<string> {
  const init = await mcpCall(request, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'e2e', version: '1' },
    },
  }, bearer);
  if (!init.sessionId) throw new Error(`MCP init missing session id (status=${init.status})`);
  await mcpCall(request, { jsonrpc: '2.0', method: 'notifications/initialized' }, bearer, init.sessionId);
  return init.sessionId;
}

interface SSEEvent {
  event: string;
  data: any;
}

function parseSSE(text: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  for (const block of text.split('\n\n')) {
    const lines = block.split('\n');
    let evName = '';
    let dataRaw = '';
    for (const l of lines) {
      if (l.startsWith('event: ')) evName = l.slice(7).trim();
      else if (l.startsWith('data: ')) dataRaw += l.slice(6);
    }
    if (!evName) continue;
    let data: any = dataRaw;
    try { data = JSON.parse(dataRaw); } catch { /* keep raw */ }
    events.push({ event: evName, data });
  }
  return events;
}

test.describe.serial('M6 visitor chat (code + SSE + mock provider)', () => {
  test('admin creates code → visitor session → SSE chat → mock reply assembled', async ({ request }) => {
    resetInstance();

    // 1. claim instance
    const setupToken = findSetupToken();
    const claimRes = await request.post('/api/admin/claim', {
      data: {
        token: setupToken,
        email: 'sijie@example.com',
        password: PASSWORD,
        handle: 'sijie',
        full_name: 'Sijie Wang',
      },
    });
    expect(claimRes.status()).toBe(200);

    // 2. login + create API token (for MCP)
    const login = await request.post('/api/admin/login', {
      data: { email: 'sijie@example.com', password: PASSWORD },
    });
    expect(login.status()).toBe(200);
    const { csrf_token: csrf } = await login.json();
    const tok = await request.post('/api/admin/tokens', {
      headers: { 'X-Csrftoken': csrf },
      data: { name: 'e2e-token' },
    });
    const { plaintext: apiToken } = await tok.json();

    // 3. seed wiki via MCP（RAG ground truth）
    const sid = await initMCP(request, apiToken);
    const dump = await mcpCall(request, {
      jsonrpc: '2.0', id: 10, method: 'tools/call',
      params: {
        name: 'raw_dump',
        arguments: {
          body: 'sijie likes ASCII art.',
          source: 'mcp:e2e',
          tags: ['intro'],
        },
      },
    }, apiToken, sid);
    expect(dump.status).toBe(200);
    const { raw_id: rawID } = JSON.parse(dump.body!.result.content[0].text);

    const promote = await mcpCall(request, {
      jsonrpc: '2.0', id: 11, method: 'tools/call',
      params: {
        name: 'promote_to_wiki',
        arguments: {
          raw_id: rawID,
          title: 'Sijie intro',
          visibility: 'public',
        },
      },
    }, apiToken, sid);
    expect(promote.status).toBe(200);

    // 4. admin POST /api/admin/codes 创建 code
    const codeRes = await request.post('/api/admin/codes', {
      headers: { 'X-Csrftoken': csrf },
      data: {
        code: 'INTRO-001',
        label: 'Intro for e2e',
        purpose: 'm6 verification',
        included_tags: ['intro'],
        excluded_tags: [],
        suggested_questions: ['who is sijie?'],
      },
    });
    expect(codeRes.status()).toBe(201);
    const created = await codeRes.json();
    expect(created.code).toBe('INTRO-001');

    // 5. visitor 颁发 session（无 owner auth）
    const sess = await request.post('/api/v1/sessions', {
      data: {
        handle: 'sijie',
        code: 'INTRO-001',
        visitor_name: 'curious visitor',
      },
    });
    expect(sess.status()).toBe(200);
    const sessBody = await sess.json();
    expect(sessBody.session_token).toMatch(/^smv_/);
    expect(sessBody.conversation_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(sessBody.owner_handle).toBe('sijie');
    expect(sessBody.included_tags).toContain('intro');

    // 6. visitor POST messages → SSE → 拿 token + done
    const msgRes = await request.post(`/api/v1/sessions/${sessBody.conversation_id}/messages`, {
      headers: {
        Authorization: `Bearer ${sessBody.session_token}`,
        'Content-Type': 'application/json',
      },
      data: { content: 'Tell me about sijie.' },
    });
    expect(msgRes.status()).toBe(200);
    expect(msgRes.headers()['content-type']).toContain('text/event-stream');

    const sseText = await msgRes.text();
    const events = parseSSE(sseText);
    const tokens = events.filter((e) => e.event === 'token');
    const dones = events.filter((e) => e.event === 'done');
    const errors = events.filter((e) => e.event === 'error');

    // 没有 error
    expect(errors).toEqual([]);
    // 至少一个 token + 恰好一个 done
    expect(tokens.length).toBeGreaterThan(0);
    expect(dones.length).toBe(1);

    // token 拼起来 = mock reply
    const assembled = tokens.map((e) => e.data.text).join('');
    expect(assembled).toBe(MOCK_REPLY);

    // done 携带 cited wiki ids
    expect(dones[0].data.cited_wiki_ids).toBeDefined();
    expect(Array.isArray(dones[0].data.cited_wiki_ids)).toBe(true);
    expect(dones[0].data.cited_wiki_ids.length).toBeGreaterThan(0);
  });

  test('invalid code rejected', async ({ request }) => {
    const sess = await request.post('/api/v1/sessions', {
      data: {
        handle: 'sijie',
        code: 'NOPE-999',
        visitor_name: 'curious visitor',
      },
    });
    expect(sess.status()).toBe(401);
    const body = await sess.json();
    expect(body.error.code).toBe('code_invalid');
  });

  test('missing bearer rejected', async ({ request }) => {
    const msg = await request.post('/api/v1/sessions/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/messages', {
      data: { content: 'hi' },
    });
    expect(msg.status()).toBe(401);
    const body = await msg.json();
    expect(body.error.code).toBe('unauthorized');
  });
});
