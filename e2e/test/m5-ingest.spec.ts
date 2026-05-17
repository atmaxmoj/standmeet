import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';

// M5 DoD：MCP raw_dump → admin GET /api/admin/raw 看到 → promote_to_wiki
// → admin GET /api/admin/wiki 看到。

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

test.describe.serial('M5 corpus ingest', () => {
  test('raw_dump → admin raw → promote_to_wiki → admin wiki', async ({ request }) => {
    resetInstance();

    // claim
    const setupToken = findSetupToken();
    await request.post('/api/admin/claim', {
      data: {
        token: setupToken,
        email: 'sijie@example.com',
        password: PASSWORD,
        handle: 'sijie',
        full_name: 'Sijie Wang',
      },
    });

    // login + token
    const login = await request.post('/api/admin/login', {
      data: { email: 'sijie@example.com', password: PASSWORD },
    });
    const { csrf_token: csrf } = await login.json();
    const create = await request.post('/api/admin/tokens', {
      headers: { 'X-Csrftoken': csrf },
      data: { name: 'e2e-token' },
    });
    const { plaintext: apiToken } = await create.json();

    // MCP init
    const sid = await initMCP(request, apiToken);

    // raw_dump
    const dump = await mcpCall(request, {
      jsonrpc: '2.0', id: 10, method: 'tools/call',
      params: {
        name: 'raw_dump',
        arguments: {
          body: 'A first insight pushed via MCP.',
          source: 'mcp:e2e',
          tags: ['test', 'm5'],
        },
      },
    }, apiToken, sid);
    expect(dump.status).toBe(200);
    const dumpText = dump.body!.result.content[0].text;
    const { raw_id: rawID } = JSON.parse(dumpText);
    expect(rawID).toMatch(/^[0-9a-f-]{36}$/);

    // admin GET /raw 看到那条
    const adminRaw = await request.get('/api/admin/raw');
    expect(adminRaw.status()).toBe(200);
    const rawList = await adminRaw.json();
    expect(Array.isArray(rawList)).toBe(true);
    const found = rawList.find((r: any) => r.id === rawID);
    expect(found).toBeTruthy();
    expect(found.body).toBe('A first insight pushed via MCP.');
    expect(found.source).toBe('mcp:e2e');
    expect(found.tags).toContain('test');

    // promote_to_wiki
    const promote = await mcpCall(request, {
      jsonrpc: '2.0', id: 11, method: 'tools/call',
      params: {
        name: 'promote_to_wiki',
        arguments: {
          raw_id: rawID,
          title: 'First Insight',
          visibility: 'public',
        },
      },
    }, apiToken, sid);
    expect(promote.status).toBe(200);
    const promoteText = promote.body!.result.content[0].text;
    const { wiki_id: wikiID } = JSON.parse(promoteText);
    expect(wikiID).toMatch(/^[0-9a-f-]{36}$/);

    // admin GET /wiki 看到
    const adminWiki = await request.get('/api/admin/wiki');
    expect(adminWiki.status()).toBe(200);
    const wikiList = await adminWiki.json();
    const wikiFound = wikiList.find((w: any) => w.id === wikiID);
    expect(wikiFound).toBeTruthy();
    expect(wikiFound.title).toBe('First Insight');
    expect(wikiFound.visibility).toBe('public');
    expect(wikiFound.tags).toContain('test');
  });
});
