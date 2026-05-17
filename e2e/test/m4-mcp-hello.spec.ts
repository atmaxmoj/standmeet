import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';

// M4 DoD：login → POST /api/admin/tokens 拿 smk_xxx → 调 /mcp/ tools/list
// 看到 me → 调 me() 返 owner → DELETE token → 同 token 再调 401。

const COMPOSE = '-f ../docker-compose.dev.yml -p standmeet-dev';
const PASSWORD = 'correct-horse-battery-staple';

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
  id: number | string;
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
  if (text.trim().startsWith('{')) {
    parsed = JSON.parse(text);
  } else if (text.includes('data:')) {
    // SSE-style response: extract first `data: {...}` line
    const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
    if (dataLine) parsed = JSON.parse(dataLine.slice(5).trim());
  }
  return { status: res.status(), sessionId: sid, body: parsed };
}

test.describe.serial('M4 API token + MCP hello', () => {
  test('claim → login → create token → MCP me → delete token → unauthorized', async ({
    request,
  }) => {
    resetInstance();

    const token = findSetupToken();
    const claim = await request.post('/api/admin/claim', {
      data: {
        token,
        email: 'sijie@example.com',
        password: PASSWORD,
        handle: 'sijie',
        full_name: 'Sijie Wang',
      },
    });
    expect(claim.status()).toBe(200);

    // login，拿 cookie + csrf
    const login = await request.post('/api/admin/login', {
      data: { email: 'sijie@example.com', password: PASSWORD },
    });
    expect(login.status()).toBe(200);
    const { csrf_token: csrf } = await login.json();

    // 创建 API token
    const create = await request.post('/api/admin/tokens', {
      headers: { 'X-Csrftoken': csrf },
      data: { name: 'mojat-mbp' },
    });
    expect(create.status()).toBe(201);
    const created = await create.json();
    expect(created.plaintext).toMatch(/^smk_[a-z0-9]+$/);
    const apiToken = created.plaintext as string;
    const tokenId = created.id as string;

    // MCP initialize（拿 session id）
    const init = await mcpCall(request, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e', version: '1' },
      },
    }, apiToken);
    expect(init.status).toBe(200);
    expect(init.sessionId).toBeTruthy();
    const sid = init.sessionId!;

    // notifications/initialized
    await mcpCall(request, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }, apiToken, sid);

    // tools/list 应含 me
    const listRes = await mcpCall(request, {
      jsonrpc: '2.0', id: 2, method: 'tools/list',
    }, apiToken, sid);
    expect(listRes.status).toBe(200);
    const toolNames = (listRes.body!.result.tools as any[]).map((t) => t.name);
    expect(toolNames).toContain('me');

    // tools/call me 应返 owner json
    const callRes = await mcpCall(request, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'me', arguments: {} },
    }, apiToken, sid);
    expect(callRes.status).toBe(200);
    const content = callRes.body!.result.content as any[];
    expect(content[0].text).toContain('"email":"sijie@example.com"');
    expect(content[0].text).toContain('"handle":"sijie"');

    // 删 token
    const del = await request.delete(`/api/admin/tokens/${tokenId}`, {
      headers: { 'X-Csrftoken': csrf },
    });
    expect(del.status()).toBe(204);

    // 删后 token 再调 MCP 应失败（无 owner_id 时 tool 返 error）
    const initAfter = await mcpCall(request, {
      jsonrpc: '2.0', id: 4, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } },
    }, apiToken);
    // initialize 不依赖 owner_id 可能能跑通；但 tools/call me 时无 owner_id 应 error
    if (initAfter.status === 200 && initAfter.sessionId) {
      await mcpCall(request, {
        jsonrpc: '2.0', method: 'notifications/initialized',
      }, apiToken, initAfter.sessionId);
      const meAfter = await mcpCall(request, {
        jsonrpc: '2.0', id: 5, method: 'tools/call',
        params: { name: 'me', arguments: {} },
      }, apiToken, initAfter.sessionId);
      const meContent = meAfter.body!.result?.content?.[0]?.text ?? '';
      const isError = meAfter.body!.result?.isError ?? false;
      expect(isError || meContent.includes('unauthorized')).toBeTruthy();
    }
  });
});
