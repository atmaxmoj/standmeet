// chat-repeat-big-tool-call.spec.ts —— F-D-14：**工具循环和压缩互相追着跑**。
//
// prod 上量到的（2026-08-21，真第三方 DeepWiki）：一轮里 `read_wiki_contents` 被调用 **8 次**，
// 每次回 374871 字节，中间夹着 **8 次** `context compacted`，两者交替，整轮 248 秒。取回来 →
// 结果大到活不过 32K 窗口 → 压缩把它吃掉 → 模型发现证据没了 → 再取一遍。访客等四分钟、屏幕上
// 八张一模一样的工具卡、第三方被拉了 3MB。
//
// **别把「重取」本身当缺陷**：eval 那侧量过，重取是模型正常的恢复动作（compaction-test.sh 的
// 工具腿）。缺陷是**没有任何东西打断这个循环** —— 八次一模一样的调用没有一次被拦下。
//
// 判据落在**被调的那一侧**（mcp-server-mock 的 `/__mock/calls`）：只有它数得清「这一次调用有
// 没有真的又打到对面」（[[write-with-no-receipt]]）。
//
// 第二条是**正对照，而且是这条守卫的一半价值**：结果小的工具重复调用**必须照常派发**。
// 「约完之后再查一次时段」是真实且正确的动作；一刀切地按 (name,args) 去重会把它一起拿掉，
// 而那种闸门 CI 全绿、闸门不响（[[gate-granularity-removes-working-action]]）。

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

/** 派发计数，从**外部 server 自己**读 —— 产品说它调了几次不算数。 */
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
    // 两次**一模一样**的调用（同名、同参），外加一句收尾回复。两个 tag 都埋进同一条消息：
    // takeToolFor 按注册顺序单次消费，而这一轮里每一次请求都带着这条消息，所以第二次
    // 模型调用会取到第二条注册 —— 这就是 prod 那个「取完又取」的形状。
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
