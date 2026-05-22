// mcp-auth.spec.ts —— MCP 必须拿合法 Bearer token 才能用任何 tool。
//
// 没 token / 错 token / claim 之前的实例 → tool call 必须失败。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.describe.serial('MCP rejects bad Bearer tokens', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('tool call without Bearer → isError unauthorized', async ({ playwright }) => {
    const ctx = await playwright.request.newContext();
    const session = await mcpInitNoAuth(ctx);
    const out = await mcpCallTool(ctx, session, 'list_recent_raw', {}, undefined);
    expect(isUnauthorized(out)).toBe(true);
    await ctx.dispose();
  });

  test('tool call with garbage Bearer → isError unauthorized', async ({ playwright }) => {
    const ctx = await playwright.request.newContext();
    const session = await mcpInitNoAuth(ctx);
    const out = await mcpCallTool(ctx, session, 'list_recent_raw', {}, 'not-a-real-token');
    expect(isUnauthorized(out)).toBe(true);
    await ctx.dispose();
  });
});

async function mcpInitNoAuth(
  ctx: APIRequestContext,
): Promise<string> {
  const res = await ctx.post(`${BACKEND}/mcp`, {
    headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
    data: {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05', capabilities: {},
        clientInfo: { name: 'e2e', version: '1' },
      },
    },
  });
  return res.headers()['mcp-session-id'] ?? '';
}

async function mcpCallTool(
  ctx: APIRequestContext,
  session: string,
  name: string,
  args: Record<string, unknown>,
  bearer: string | undefined,
): Promise<string> {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    'Mcp-Session-Id': session,
  };
  bearer && (headers['Authorization'] = `Bearer ${bearer}`);
  const res = await ctx.post(`${BACKEND}/mcp`, {
    headers,
    data: {
      jsonrpc: '2.0', id: 99, method: 'tools/call',
      params: { name, arguments: args },
    },
  });
  return await res.text();
}

function isUnauthorized(body: string): boolean {
  const lower = body.toLowerCase();
  return lower.includes('unauthor') || lower.includes('isError'.toLowerCase());
}
