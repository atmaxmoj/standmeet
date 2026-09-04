// chat-repeat-big-tool-call.spec.ts —— F-D-14: **the tool loop and compaction chase each other**.
//
// measured on prod (2026-08-21, real third-party DeepWiki): in one turn `read_wiki_contents` was called **8 times**,
// each returning 374871 bytes, interleaved with **8** `context compacted` events, alternating, 248 seconds for the whole turn.
// Fetch it → the result is too big to survive the 32K window → compaction eats it → the model finds the evidence gone → fetch it again.
// The visitor waits four minutes, eight identical tool cards on screen, 3MB pulled from the third party.
//
// **don't treat "refetching" itself as the defect**: the eval side measured it, refetching is the model's normal recovery action
// (the tool leg of compaction-test.sh). The defect is that **nothing interrupts this loop** —— not one of the eight identical calls is stopped.
//
// the check lands on **the side being called** (mcp-server-mock's `/__mock/calls`): only it can count whether "this call actually hit
// the far side again" ([[write-with-no-receipt]]).
//
// the second test is **the positive control, and half the value of this guard**: a repeated small-result tool call **must dispatch as usual**.
// "check the times again after booking" is a real and correct action; deduping bluntly by (name,args) would take it out too,
// and that kind of gate is green in CI, the gate never fires ([[gate-granularity-removes-working-action]]).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { scriptMockReplyText, scriptMockToolCall, sendAndDrain } from '@/fixtures/mock-llm-script';
import { createRole } from '@/fixtures/roles';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'repeat@example.com', password: 'correct-horse-battery-staple',
  handle: 'repeat', fullName: 'Repeat Owner',
};
const CODE = 'REPEAT-001';
const SERVER_NAME = 'bigpage';
const MOCK_MCP_URL = 'http://mcp-server-mock:9100/mcp';
const MOCK_MCP_ADMIN = process.env['MCP_MOCK_URL'] ?? 'http://localhost:9100';

const BIG_TOOL = `ext_${SERVER_NAME}_big_page`;
const SMALL_TOOL = `ext_${SERVER_NAME}_ping_external`;

interface CreateServerResp { id: string }

/** dispatch counts, read from **the external server itself** —— what the product says it called doesn't count. */
async function dispatchCounts(request: APIRequestContext): Promise<Record<string, number>> {
  const res = await request.get(`${MOCK_MCP_ADMIN}/__mock/calls`);
  if (res.status() !== 200) throw new Error(`__mock/calls: ${res.status()}`);
  return await res.json() as Record<string, number>;
}

async function resetCounts(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${MOCK_MCP_ADMIN}/__mock/calls/reset`);
  if (res.status() !== 200) throw new Error(`__mock/calls/reset: ${res.status()}`);
}

test.describe.serial('F-D-14 · a repeated oversized tool call is not fetched twice', () => {
  let request: APIRequestContext;
  let session: VisitorSession;

  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000);
    resetInstance();
    request = await playwright.request.newContext({ timeout: 30_000 });
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const apiToken = await createAPIToken(request, csrf, 'fd14-token');
    const sid = await initMCP(request, apiToken);
    const server = await callTool<CreateServerResp>(request, apiToken, sid, 'mcp_server_create', {
      name: SERVER_NAME, url: MOCK_MCP_URL,
    });
    const role = await createRole(request, csrf, {
      name: 'fd14-role', description: 'repeat-call spec',
      corpus_uris: ['wiki://**'], mcp_server_ids: [server.id],
    });
    await createCode(request, csrf, {
      code: CODE, label: 'repeat', assumed_role_id: role.id, max_turns_per_session: 20,
    });
    session = await issueSession(request, {
      handle: OWNER.handle, code: CODE, visitor_name: 'Repeat Auditor',
    });
  });

  test.afterAll(async () => { await request.dispose(); });

  test('the same oversized call, twice in one turn, reaches the server once', async () => {
    test.setTimeout(180_000);
    await resetCounts(request);
    // two **identical** calls (same name, same args), plus a closing reply. Both tags are buried in the same message:
    // takeToolFor consumes them once each in registration order, and every request in this turn carries that message, so the second
    // model call picks up the second registration —— that's the shape of prod's "fetch, then fetch again".
    const first = await scriptMockToolCall(request, { name: BIG_TOOL, args: { page: 'alpha' } });
    const again = await scriptMockToolCall(request, { name: BIG_TOOL, args: { page: 'alpha' } });
    const done = await scriptMockReplyText(request, 'here is what the page says');
    await sendAndDrain(request, session, `read the big page${first}${again}${done}`);

    const counts = await dispatchCounts(request);
    expect(
      counts[BIG_TOOL.replace(`ext_${SERVER_NAME}_`, '')] ?? 0,
      'the second identical call must be answered from this turn\'s own ledger, not fetched again '
      + '— the result is too big to survive compaction, so re-fetching just re-triggers it '
      + '(prod: 8 fetches × 374871 bytes, 8 compactions, 248 seconds)',
    ).toBe(1);
  });

  test('a repeated SMALL call is still dispatched — re-checking is a real action', async () => {
    test.setTimeout(180_000);
    await resetCounts(request);
    const first = await scriptMockToolCall(request, { name: SMALL_TOOL, args: {} });
    const again = await scriptMockToolCall(request, { name: SMALL_TOOL, args: {} });
    const done = await scriptMockReplyText(request, 'checked twice');
    await sendAndDrain(request, session, `ping it twice${first}${again}${done}`);

    const counts = await dispatchCounts(request);
    expect(
      counts['ping_external'] ?? 0,
      'a small result survives the window, so asking again is the model\'s business — dedup must '
      + 'not reach it, or "check the slots again after booking" quietly stops working',
    ).toBe(2);
  });
});
