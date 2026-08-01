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

test.describe('MCP rejects bad Bearer tokens', () => {
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
    const out = await mcpCallTool(ctx, session, 'corpus.list', { genre: 'raw' }, undefined);
    expect(isUnauthorized(out)).toBe(true);
    await ctx.dispose();
  });

  test('tool call with garbage Bearer → isError unauthorized', async ({ playwright }) => {
    const ctx = await playwright.request.newContext();
    const session = await mcpInitNoAuth(ctx);
    const out = await mcpCallTool(ctx, session, 'corpus.list', { genre: 'raw' }, 'not-a-real-token');
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

// isUnauthorized —— 必须是**真 auth 拒绝**信号(后端返 "unauthorized: invalid or missing api
// token" / "unauthorized: invalid Sigv1")。**不接受裸 isError**:MCP 对任何 tool 错误都返
// isError,若 auth 没生效但 tool 因别的原因报错,裸 isError 会让 broken-auth 蒙混成"已拒绝"。
function isUnauthorized(body: string): boolean {
  return body.toLowerCase().includes('unauthor');
}
