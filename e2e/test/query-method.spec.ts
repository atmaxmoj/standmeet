// query-method.spec.ts —— HTTP QUERY (RFC 10008) on the per-tool dispatch.
//
// Read-only retrieval tools (corpus_search / corpus_read — the retrieval plugin declares MCP
// `annotations.readOnlyHint=true`) answer QUERY: safe, idempotent, body-carrying — the semantically
// correct method. POST still works (backward compatible). A MUTATING tool (calendar_book) + QUERY → 405.
//
// This proves the whole readOnlyHint chain end-to-end:
//   plugin annotation → mcpclient.Tool.ReadOnly → BindingTool.ReadOnly → dispatch gate.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { createRole } from '@/fixtures/roles';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { issueSession } from '@/fixtures/visitor';
import { seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed } from '@/fixtures/gcal-setup';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

interface ToolResp { ok?: boolean; reason?: string; result?: unknown }

async function dispatch(
  request: APIRequestContext, method: string, conv: string, token: string, tool: string, body: object,
): Promise<{ status: number; body: ToolResp }> {
  const res = await request.fetch(`${BACKEND}/api/v1/sessions/${conv}/tools/${tool}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    data: body,
  });
  return { status: res.status(), body: await res.json() as ToolResp };
}

test.describe('QUERY (RFC 10008) on read-only retrieval tools', () => {
  test.describe.configure({ timeout: 90_000 });
  const O = {
    email: 'querytest@example.com', password: 'correct-horse-battery-staple',
    handle: 'querytest', fullName: 'Query Test Owner',
  };
  const CODE = 'INTRO-QUERY';
  let request: APIRequestContext;
  let conv = '';
  let token = '';

  test.beforeAll(async ({ playwright }) => {
    request = await playwright.request.newContext();
    resetInstance();
    await claim(request, findSetupToken(), O);
    const { csrf } = await loginAPI(request, O.email, O.password);
    const ownerToken = await createAPIToken(request, csrf, 'owner');
    const sid = await initMCP(request, ownerToken);
    const raw = await callTool<{ raw_id: string }>(request, ownerToken, sid, 'raw_dump',
      { body: 'At FlowPay I built a payment reconciliation pipeline over Kafka.', source: 'mcp', tags: [] });
    await callTool(request, ownerToken, sid, 'promote_to_wiki',
      { raw_id: raw.raw_id, title: 'Payment reconciliation pipeline', tags: [] });
    const role = await createRole(request, csrf, {
      name: 'q-corpus', description: 'corpus retrieval', corpus_uris: ['wiki://**'],
    });
    await createCode(request, csrf, { code: CODE, label: 'q', purpose: 'query test', assumed_role_id: role.id });
    const sess = await issueSession(request, { handle: O.handle, code: CODE, visitor_name: 'V' });
    conv = sess.conversation_id;
    token = sess.session_token;
  });
  test.afterAll(async () => { await request.dispose(); });

  test('QUERY corpus_search → 200 (read-only tool answers QUERY)', async () => {
    const { status, body } = await dispatch(request, 'QUERY', conv, token,
      'corpus_search', { query: 'payment reconciliation pipeline' });
    expect(status, 'QUERY allowed on read-only corpus_search').toBe(200);
    expect(body.ok, 'endpoint envelope ok').toBe(true);
  });

  test('POST corpus_search → 200 (backward compatible)', async () => {
    const { status } = await dispatch(request, 'POST', conv, token,
      'corpus_search', { query: 'payment reconciliation pipeline' });
    expect(status, 'POST still works on read-only tool').toBe(200);
  });

  test('QUERY corpus_read → 200 (read-only)', async () => {
    const { status } = await dispatch(request, 'QUERY', conv, token,
      'corpus_read', { path: 'payment-reconciliation-pipeline' });
    expect(status, 'QUERY allowed on read-only corpus_read').toBe(200);
  });
});

test.describe('QUERY on a mutating tool → 405', () => {
  test.describe.configure({ timeout: 90_000 });
  let seed: CodedSeed;

  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'], max_bookings: 2,
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('QUERY calendar_book → 405 (mutating tool refuses QUERY; POST only)', async () => {
    const { status, body } = await dispatch(seed.request, 'QUERY',
      seed.visitor.conversation_id, seed.visitor.session_token,
      'calendar_book', { topic: 'x', duration_min: 30, preferred_times: [] });
    expect(status, 'QUERY on mutating calendar_book → 405').toBe(405);
    expect(body.reason, 'method_not_allowed reason').toBe('method_not_allowed');
  });
});
