// mcp-auth.spec.ts — MCP requires a valid Bearer token to use any tool.
//
// No token / wrong token / an instance not yet claimed → the tool call must fail.

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

// isUnauthorized — must be a **genuine auth-rejection** signal (the backend returns
// "unauthorized: invalid or missing api token" / "unauthorized: invalid Sigv1").
// **A bare isError is not accepted**: MCP returns isError for any tool error, so if
// auth wasn't actually enforced but the tool errored for some other reason, a bare
// isError would let broken auth pass itself off as "rejected".
function isUnauthorized(body: string): boolean {
  return body.toLowerCase().includes('unauthor');
}
