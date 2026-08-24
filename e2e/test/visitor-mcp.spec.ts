// visitor-mcp.spec.ts —— **拿着码的人可以用自己的 AI 客户端来问。**
//
// owner 早就有一个 MCP 面（`/mcp`，Sigv1）；对外却只有网页对话和给程序用的 API key。
// 招聘方扫了码、手边正开着 Claude Desktop —— 在这一面之前，他只能去网页上聊。
//
// 断的不是「MCP 协议跑得通」，而是**这只是那张码的又一个渲染**：同一份授权、同一套配额、
// 同一份记账。所以每一条用例问的都是「它凭什么会跟别的面不一样」，答案永远该是不会。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { createCode, revokeCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const MCP = `${BACKEND}/mcp/visitor`;

const OWNER = {
  email: 'visitor-mcp@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'vmcp',
  fullName: 'Visitor MCP Owner',
};

interface RPCResult { status: number; body: Record<string, unknown> }

// rpc —— **走真客户端那条路**：先 initialize 拿到会话 id，再发真正那一问。
//
// 一开始我省了握手直接发 tools/list，拿回 `Invalid session ID` —— 那是 streamable HTTP
// 协议本来就要求的一步，不是产品坏了。省掉它，测的就不是别人的客户端会走的那条路了。
async function rpc(
  request: APIRequestContext, code: string, method: string,
  params: Record<string, unknown> = {}, name?: string,
): Promise<RPCResult> {
  const opened = await initialize(request, code, name);
  if (opened.sid === '') return opened.first;
  const res = await request.post(MCP, {
    headers: mcpHeaders(code, name, opened.sid),
    data: { jsonrpc: '2.0', id: 2, method, params },
  });
  return { status: res.status(), body: parseRPC(await res.text()) };
}

function mcpHeaders(code: string, name: string | undefined, sid: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${code}`,
    ...(name === undefined ? {} : { 'X-Standmeet-Visitor': name }),
    ...(sid === '' ? {} : { 'Mcp-Session-Id': sid }),
  };
}

// initialize —— 握手。**这一步就是准入发生的地方**：码不对 / 被撤销 / 名额满了，
// 都在这里被挡下来，所以拿不到 sid 时把这一次的回应原样交回去当结论。
async function initialize(
  request: APIRequestContext, code: string, name?: string,
): Promise<{ sid: string; first: RPCResult }> {
  const res = await request.post(MCP, {
    headers: mcpHeaders(code, name, ''),
    data: {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2025-03-26', capabilities: {},
        clientInfo: { name: 'e2e', version: '0.0.0' },
      },
    },
  });
  const first = { status: res.status(), body: parseRPC(await res.text()) };
  return { sid: res.headers()['mcp-session-id'] ?? '', first };
}

// rpcNoAuth —— 一次**不带码**的调用。这一面的第一道门就是那张码，所以「什么都不带」
// 是必须驱到的一种。
async function rpcNoAuth(
  request: APIRequestContext, method: string,
): Promise<RPCResult> {
  const res = await request.post(MCP, {
    headers: { 'Content-Type': 'application/json' },
    data: { jsonrpc: '2.0', id: 1, method, params: {} },
  });
  return { status: res.status(), body: parseRPC(await res.text()) };
}

// rpcNoAuthRaw —— 不带凭据发一次，**把原始响应交回去**：这一条要断的是响应头，
// 而上面那个 helper 只交回 body。
async function rpcNoAuthRaw(request: APIRequestContext) {
  return request.post(MCP, {
    headers: { 'Content-Type': 'application/json' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  });
}

// parseRPC —— streamable HTTP 可能以 SSE 帧回，也可能直接回 JSON。两种都得读得懂，
// 否则「协议对不上」会被读成「产品坏了」。
function parseRPC(text: string): Record<string, unknown> {
  const line = text.split('\n').find((l) => l.startsWith('data:'));
  const raw = line === undefined ? text : line.slice('data:'.length);
  try {
    return JSON.parse(raw.trim()) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

// refusalOf —— 一次拒绝里**那句给人看的话**。
//
// 拒绝现在走 JSON-RPC 错误（HTTP 200），因为在 MCP 里 401 的语义是「去做 OAuth」，
// 客户端渲染的是错误对象而不是状态码（F-P-8）。所以断言也得跟着挪到那一层 ——
// 这一族里每一条拒绝用例都从这里取词。
function refusalOf(res: RPCResult): string {
  const err = res.body['error'] as { message?: unknown } | undefined;
  return typeof err?.message === 'string' ? err.message : '';
}

// grantedOK —— 这次调用是**成功**的：拿到了 result，而且没有 error。
// 只断 HTTP 200 已经不够了 —— 拒绝现在也是 200。
function grantedOK(res: RPCResult): boolean {
  return res.body['result'] !== undefined && res.body['error'] === undefined;
}

function toolNames(body: Record<string, unknown>): string[] {
  const result = body['result'] as { tools?: { name: string }[] } | undefined;
  return (result?.tools ?? []).map((t) => t.name);
}

// OUTWARD —— 对外那一组工具。**线上报出来的每一个名字都必须在这里面**。
// owner 面和访客面住在同一个进程、挂载点只差一个前缀，一个 owner 工具漏到这张表上，
// 访客的 AI 就直接拿到了它。
const OUTWARD = [
  'corpus_search', 'corpus_read', 'corpus_list', 'corpus_links',
  'calendar_list_slots', 'calendar_book',
];

// expectAllOutward —— 清单那侧的棘轮两边读的是同一份名单，证不了「这一面真的挂对了」；
// 只有问活着的端点才分得出「挂上了正确的一组」和「挂上了别的一组 / 过滤器太狠」。
function expectAllOutward(names: string[]): void {
  for (const n of names) {
    expect(OUTWARD, `the live face advertises "${n}", which is not an outward tool`)
      .toContain(n);
  }
}

interface Admin { request: APIRequestContext; csrf: string }

async function freshOwner(playwright: Playwright): Promise<Admin> {
  resetInstance();
  const request = await playwright.request.newContext({ timeout: 30_000 });
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  return { request, csrf };
}

test.describe('a visitor can point their own AI client at this instance', () => {
  let admin: Admin;

  test.beforeEach(async ({ playwright }) => { admin = await freshOwner(playwright); });
  test.afterEach(async () => { await admin.request.dispose(); });

  test('a code opens the MCP face, and it lists the tools that code grants', async () => {
    const code = await createCode(admin.request, admin.csrf,
      { code: 'MCPV-001', label: 'OWN CLIENT' });
    expect(code.code).toBe('MCPV-001');

    const listed = await rpc(admin.request, 'MCPV-001', 'tools/list');
    expect(grantedOK(listed), JSON.stringify(listed.body)).toBe(true);
    const names = toolNames(listed.body);
    // 断**有工具**，不是「没报错」：一个空表在协议上完全合法，而对访客的 AI 来说
    // 等于这个实例什么也不提供（[[assertion-that-cannot-fail]]）。
    expect(names.length, 'the code grants something to work with').toBeGreaterThan(0);

    expectAllOutward(names);
  });

  // F-P-8 —— 拒绝要答在**对方在听的那一层**。
  //
  // 这条曾经断 401 + `WWW-Authenticate`。头按 RFC 6750 写对了，然而在 MCP 里 401 的语义
  // **就是**「去做 OAuth」，于是官方 Inspector 转头去跑发现流程，屏幕上是
  // `Interactive OAuth requires a TTY`，我们那句「带上你的访问码」一个字没露面。
  //
  // 所以现在断的是 JSON-RPC 错误对象 —— 客户端渲染的正是它。
  test('a refusal comes back as a JSON-RPC error, which is what a client renders',
    async () => {
      const res = await rpcNoAuthRaw(admin.request);
      const body = parseRPC(await res.text());
      const err = body['error'] as { message?: unknown; data?: { http_status?: number } };
      expect(typeof err?.message === 'string' ? err.message : '',
        'the sentence must be where the client will render it').toMatch(/access code/i);
      // 种类也要留住：401 是票不对，429 是被闸挡住，两种人的下一步不一样。
      expect(err?.data?.http_status, 'the kind of refusal survives the move').toBe(401);
    });

  // **id 必须回显。** 按 id 配对响应的客户端收到 `id:null` 会当成对不上而一直等 ——
  // 一个永远不返回的调用，比一句难看的错误糟得多。
  test('a refusal echoes the request id, so the client can match it', async () => {
    const res = await rpcNoAuthRaw(admin.request);
    expect(parseRPC(await res.text())['id'], 'the client pairs on this').toBe(1);
  });

  test('no code at all is refused, and says how to present one', async () => {
    const bare = await rpcNoAuth(admin.request, 'tools/list');
    // 拒绝要说得出下一步 —— 只回一个状态码的话，对面的客户端不知道该带什么。
    expect(refusalOf(bare), 'it names the credential to bring').toMatch(/access code/i);
  });

  test('a code that does not exist is refused in the same words as everywhere else',
    async () => {
      const res = await rpc(admin.request, 'NOPE-999', 'tools/list');
      // 断**那句话本身**，不是「有回应」。同一张拒绝表（visitorErrCases）意味着
      // 打错字的人在这一面读到的，跟他在网页上读到的是同一句 —— 而这一句指的是
      // 下一步（重新粘一次），不是一个状态码。
      expect(refusalOf(res),
        'the same words the web path uses for a typo').toMatch(/no such access code/i);
    });

  test('a revoked code stops working on this face too', async () => {
    const code = await createCode(admin.request, admin.csrf,
      { code: 'MCPV-REV', label: 'REVOKED' });
    // 撤销**之前**先证它是通的 —— 少了这一句，撤销之后的红可能一直都是红。
    expect(grantedOK(await rpc(admin.request, 'MCPV-REV', 'tools/list')),
      'it works before the revoke').toBe(true);

    await revokeCode(admin.request, admin.csrf, code.id);

    // **撤销是撤销**。少了这一条，owner 以为收回了授权，而那个客户端还连着。
    // 断那句话而不是状态码：撤销跟打错字要说不同的话，两种人的下一步不一样。
    const after = await rpc(admin.request, 'MCPV-REV', 'tools/list');
    expect(refusalOf(after), 'a revoked code cannot open the MCP face')
      .toMatch(/revoked/i);
  });

  test('the name the client sends reaches the owner’s transcript', async () => {
    await createCode(admin.request, admin.csrf, { code: 'MCPV-WHO', label: 'NAMED' });
    const named = await rpc(admin.request, 'MCPV-WHO', 'tools/list', {}, 'Rae From Claude');
    expect(grantedOK(named), JSON.stringify(named.body)).toBe(true);

    // 网页那条路有「你是谁」的弹窗，这一面没有界面可弹 —— 但 owner 那一侧
    // 不该因此看到一段没有来处的逐字稿。
    const convos = await admin.request.get(`${BACKEND}/api/admin/conversations`,
      { headers: { 'X-Csrftoken': admin.csrf } });
    expect(convos.status()).toBe(200);
    expect(JSON.stringify(await convos.json()),
      'the owner can tell who this was').toContain('Rae From Claude');
  });

  test('the member allowance is the code’s allowance here too', async () => {
    await createCode(admin.request, admin.csrf,
      { code: 'MCPV-CAP', label: 'CAPPED', max_members: 1 });
    // 第一个名字先进得来 —— 正对照，否则第二个被挡可能跟名额无关。
    expect(grantedOK(await rpc(admin.request, 'MCPV-CAP', 'tools/list', {}, 'First')),
      'the first name gets in').toBe(true);

    // 第二个名字要被同一套名额挡住 —— 换一个面不该换一套规矩。
    // 断那句话：跟网页上那个人读到的是同一句「这张码满了」。
    const second = await rpc(admin.request, 'MCPV-CAP', 'tools/list', {}, 'Second');
    expect(refusalOf(second), 'a full code admits no one new, on any face')
      .toMatch(/full|no more names/i);
  });
});
