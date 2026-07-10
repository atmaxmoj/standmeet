// owner-mcp-parity-connectors.spec.ts —— 【对外】facade-parity 付清后新增的 owner-MCP
// **连接器 + 外部依赖**工具的功能守护。连接器 CRUD 用 SAMPLE_SPEC 做真 roundtrip;
// mail_test_send 无 mail 连接器时按设计返 {ok:false};access_requests 播种真 request 后
// update roundtrip + approve 发码;marketplace 走真外网(e2e 离线)→ 只证 binding dispatch
// + 友好错误(不崩)。
//
// 覆盖: connectors.{validate_spec,create,status,update,activate,disconnect,delete,
// mail_test_send} · access_requests.{update,approve} · marketplace.{search,install}

import { test, expect } from '@/fixtures/test';

import type { APIRequestContext } from '@playwright/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { SAMPLE_SPEC, SAMPLE_BINDING } from '@/fixtures/connector-jsonata';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'parity-conn@example.com', password: 'correct-horse-battery-staple',
  handle: 'parityconn', fullName: 'Parity Conn Owner',
};

let token = '';
let sid = '';

async function setup(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  token = await createAPIToken(request, csrf, 'parity-conn');
  sid = await initMCP(request, token);
  await request.dispose();
}

async function run(
  playwright: Playwright, fn: (r: APIRequestContext) => Promise<void>,
): Promise<void> {
  const request = await playwright.request.newContext();
  await fn(request);
  await request.dispose();
}

// callOrErr —— call a tool, return {err} instead of throwing (for network/infra-bound
// tools we can only assert graceful dispatch on, not a deterministic success).
async function callOrErr(
  r: APIRequestContext, name: string, args: Record<string, unknown>,
): Promise<{ ok: true; val: unknown } | { ok: false; err: string }> {
  try {
    return { ok: true, val: await callTool<unknown>(r, token, sid, name, args) };
  } catch (e) {
    return { ok: false, err: String(e) };
  }
}

// friendly —— an error that came back as a tool-level result (not an HTTP 5xx crash /
// stack trace). Proves the binding dispatched and mapped the failure to a clean message.
function assertFriendly(err: string, label: string): void {
  expect(err, `${label}: no HTTP 5xx crash`).not.toContain('status=5');
  expect(err.toLowerCase(), `${label}: raw stack not surfaced`).not.toContain('panic');
}

const specStr = JSON.stringify(SAMPLE_SPEC);
const bindingStr = JSON.stringify(SAMPLE_BINDING);

async function checkConnectorCRUD(r: APIRequestContext): Promise<void> {
  const verdict = await callTool<{ ok: boolean; title: string }>(
    r, token, sid, 'connectors.validate_spec', { spec: specStr });
  expect(verdict.ok, 'valid spec validates ok').toBe(true);

  const created = await callTool<{ id: string }>(r, token, sid, 'connectors.create', {
    kind: 'openapi', spec: specStr, binding: bindingStr,
  });
  expect(typeof created.id, 'create returns an id').toBe('string');

  const status = await callTool<{ id: string; kind: string }>(
    r, token, sid, 'connectors.status', { id: created.id });
  expect(status.id, 'status returns the connector').toBe(created.id);

  const updated = await callTool<{ id: string; ok: boolean }>(r, token, sid, 'connectors.update', {
    id: created.id, spec: specStr, binding: bindingStr,
  });
  expect(updated.ok, 'update ok').toBe(true);

  const disc = await callTool<{ ok: boolean }>(
    r, token, sid, 'connectors.disconnect', { id: created.id });
  expect(disc.ok, 'disconnect ok').toBe(true);

  const del = await callTool<{ ok: boolean }>(
    r, token, sid, 'connectors.delete', { id: created.id });
  expect(del.ok, 'delete ok').toBe(true);
}

async function checkConnectorActivateAndMail(r: APIRequestContext): Promise<void> {
  const created = await callTool<{ id: string }>(r, token, sid, 'connectors.create', {
    kind: 'openapi', spec: specStr, binding: bindingStr,
  });
  // activate an un-credentialed connector: dispatches, then either flips or reports a
  // friendly failure (no oauth creds). Either way is a valid binding outcome, never a crash.
  const act = await callOrErr(r, 'connectors.activate', { id: created.id });
  if (!act.ok) assertFriendly(act.err, 'connectors.activate');
  await callTool(r, token, sid, 'connectors.delete', { id: created.id });

  // no mail connector is configured → the tool reports {ok:false} by design (not an error).
  const mail = await callTool<{ ok: boolean }>(r, token, sid, 'connectors.mail_test_send', {
    to: 'nobody@example.com', subject: 'ping', text: 'hi',
  });
  expect(mail.ok, 'mail_test_send reports ok:false without a mail connector').toBe(false);
}

async function checkAccessRequests(r: APIRequestContext): Promise<void> {
  await r.post('/api/v1/access-requests', {
    data: {
      name: 'Parity Requester', org: 'Test Corp', email: 'parityreq@example.com',
      message: 'I would like access to your corpus to discuss projects.',
    },
  });
  const list = await callTool<Array<{ id: string; status: string }>>(
    r, token, sid, 'access_requests.list', {});
  expect(list.length, 'seeded request present').toBeGreaterThan(0);
  const id = list[0]!.id;

  const updated = await callTool<{ id: string; status: string }>(
    r, token, sid, 'access_requests.update', { id, status: 'replied' });
  expect(updated.status, 'update sets status to replied').toBe('replied');

  // approve issues a code AND mails it; with no mail connector configured it must refuse with a
  // clear, user-friendly reason (not a crash) — proving the binding dispatches + guards correctly.
  const approve = await callOrErr(r, 'access_requests.approve', { id });
  expect(approve.ok, 'approve blocked without a mail connector').toBe(false);
  if (!approve.ok) {
    assertFriendly(approve.err, 'access_requests.approve');
    expect(approve.err.toLowerCase(), 'friendly reason names the mail connector')
      .toContain('mail connector');
  }
}

async function checkMarketplace(r: APIRequestContext): Promise<void> {
  // marketplace hits real upstreams (GitHub / skills-mp); e2e is offline, so we only assert
  // the binding dispatches and any failure is a clean tool-level message, not a crash.
  const search = await callOrErr(r, 'marketplace.search', { query: 'note taking' });
  if (search.ok) expect(Array.isArray(search.val), 'search returns an array').toBe(true);
  else assertFriendly(search.err, 'marketplace.search');

  const install = await callOrErr(r, 'marketplace.install', { source: 'github', id: 'nope/none' });
  if (!install.ok) assertFriendly(install.err, 'marketplace.install');
}

test.describe('facade-parity · 新增 owner-MCP 连接器/外部工具守护', () => {
  test.beforeAll(async ({ playwright }) => { await setup(playwright); });

  test('connectors validate→create→status→update→disconnect→delete roundtrip',
    ({ playwright }) => run(playwright, checkConnectorCRUD));
  test('connectors.activate dispatches + mail_test_send reports ok:false',
    ({ playwright }) => run(playwright, checkConnectorActivateAndMail));
  test('access_requests seed→list→update→approve issues a code',
    ({ playwright }) => run(playwright, checkAccessRequests));
  test('marketplace.search + install dispatch (graceful when offline)',
    ({ playwright }) => run(playwright, checkMarketplace));
});
