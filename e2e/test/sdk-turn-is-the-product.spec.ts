// sdk-turn-is-the-product.spec.ts —— F-O-2。**发出去的那份 SDK** 取一轮对话，走的必须是产品
// 自己那条路，而不是一条退役的裸代理。
//
// 真实环境里怎么发现的：把构建好的 embed 放到一个**异源**页面上（`localhost:41999` 指向
// `38227`），问「what is this corpus for?」，答回来的是 *"This corpus is designed to provide
// textual data for training, testing, and evaluating natural language processing models."* ——
// 一段 NLP 教科书定义，跟 owner 那 1010 条语料、跟他的声音毫无关系。
//
// 因在代码里写着：`sdk/packages/core/src/client.ts` 的 `streamMessage` 打
// `POST /api/v1/llm/chat/stream`，body 里 **`system: ''`**，它自己的注释写着 *"No tool loop;
// this is a single-turn smoke test path"*；而 `backend/.../public/chat.go:109-110` 说那条路在
// SDK 切到 `/agent/turn` 之后**退役**。app 自己的页面早切了 —— 这一轮修的 persona、skill 清单、
// 截断提示、主张闸门全在新路上 —— SDK 那一半没跟。
//
// **这条 spec 驱的是真的那份客户端**（`@standmeet/core` 的 `createClient`），不是我照着它再写一遍
// 的 fetch：照写一遍的话，改了实现它照样绿（[[test-covers-capability-not-face]]）。
//
// 判据借 F-A-36 那个办法：mock 网关把收到的 system prompt 原样回显进答案里，所以「只可能来自
// owner 人格的那句话」出现在答案里 = 那段人格真的送到了模型手上。空 system 的那条路上，它
// 不可能出现。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';
// 动态 import：这个包是 ESM-only（exports 里没有 require 条件），而 Playwright 以 CJS 加载
// spec。**要的是发布出去的那一份**，所以宁可动态 import，也不照着它再写一遍 fetch。

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';

const OWNER = {
  email: 'sdkturn@example.com',
  password: 'sdk-turn-is-the-product-1',
  handle: 'sdkturnowner',
  fullName: 'SDK Turn Owner',
};

const CODE = 'SDKTURN-01';
// 一句只可能来自 role persona 的话 —— 语料里没有，通用 header 里也没有。
const PERSONA_MARK = 'ALWAYS-NAME-THE-LEDGER-FIRST';
const ROLE = 'sdk-persona-carrier';

test.describe('F-O-2 · a turn taken through the shipped SDK is the product', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000); // resetInstance 在负载高时要 ~48s
    await initOwner(playwright);
  });

  test('the owner persona reaches the model on the SDK path, not just the app path',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const tag = await scriptMockReplyText(request, 'noted.');

      // 真的那份客户端，指着实例的绝对地址 —— 就是第三方站点上那个 embed 的用法。
      const { createClient } = await import('@standmeet/sdk-core');
      const client = createClient({ baseURL: appBaseURL() });
      const session = await client.issueSession({
        mode: 'code', code: CODE, visitor_name: 'Embedded Reader',
      });

      // 跟 embed 里一模一样的两步：这一场先把 system prompt 拼出来（fragment + persona），
      // 再拿它取一轮。少了第一步，模型收到的就是空 system —— 那正是 F-O-2 的样子。
      const system = await client.composeSystem(session);
      let answer = '';
      for await (const ev of client.streamMessage(
        session.conversation_id, session.session_token, `hello ${tag}`, system,
      )) {
        if (ev.kind === 'token') answer += ev.text;
      }

      expect(answer, 'the SDK turn produced text at all').not.toBe('');
      expect(answer,
        'the persona the owner wrote reached the model through the SDK path')
        .toContain(PERSONA_MARK);
      await request.dispose();
    });

  // F-O-7 —— 第二轮必须带着第一轮走。
  //
  // 真环境里怎么发现的：异源页面上连问两句，第二句里的「他」「它」被答成
  // *"this is the first thing I've seen in our exchange"*。**读代码坐实**：`client.ts` 的请求体里
  // `history: []` 是硬编码，而后端的模型消息就是拿 `req.History` 拼的，不按 conversation_id 回补。
  //
  // 判据不看答案 —— KV 替身的回复是脚本化的，答案里读不出「它记不记得」。改看**这个客户端真的
  // 发出去了什么**：注一个自己的 fetch（`createClient` 本来就收 `fetchImpl`），把请求体留下来。
  // 红态：第二次请求的 `history` 是空数组。
  test('the second turn carries the first — the shipped client is not memoryless',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const first = await scriptMockReplyText(request, 'Lucerna, a reading app.');
      const second = await scriptMockReplyText(request, 'Noted.');

      const bodies: string[] = [];
      const { createClient } = await import('@standmeet/sdk-core');
      const client = createClient({
        baseURL: appBaseURL(),
        fetchImpl: async (input, init) => {
          const url = typeof input === 'string' ? input : input instanceof URL
            ? input.href : input.url;
          if (url.includes('/agent/turn') && typeof init?.body === 'string') {
            bodies.push(init.body);
          }
          return fetch(input, init);
        },
      });
      const session = await client.issueSession({ mode: 'code', code: CODE });
      const system = await client.composeSystem(session);
      const ask = async (text: string): Promise<void> => {
        for await (const _ of client.streamMessage(
          session.conversation_id, session.session_token, text, system,
        )) { /* drain */ }
      };
      await ask(`what did the owner ship${first}`);
      await ask(`and what did he learn from it${second}`);

      expect(bodies, 'both turns went out').toHaveLength(2);
      const sent = JSON.parse(bodies[1] ?? '{}') as {
        history?: { role: string; content: string }[];
      };
      const hist = sent.history ?? [];
      expect(hist.length, '第二轮必须带着第一轮的问与答').toBeGreaterThanOrEqual(2);
      expect(hist.map((m) => `${m.role}:${m.content}`).join(' | '),
        '第一轮的问题在历史里')
        .toContain('what did the owner ship');
      expect(hist.map((m) => m.content).join(' | '), '第一轮的答案也在历史里')
        .toContain('Lucerna');
      await request.dispose();
    });
});

// appBaseURL —— 走 127.0.0.1 而不是 localhost：Node 会先解析到 ::1，而端口只在 IPv4 上监听，
// 于是 fetch 直接 ECONNREFUSED（浏览器不会这样，所以这一步只在 node 侧的 spec 里咬人）。
function appBaseURL(): string {
  return (process.env['BASE_URL'] ?? 'http://localhost:38127')
    .replace('localhost', '127.0.0.1');
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'sdk-turn-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'the ledger is where the work is recorded.', title: 'Ledger',
  });
  const roleID = await createRoleWithPersona(request, csrf);
  await createCode(request, csrf, { code: CODE, label: 'SDK', assumed_role_id: roleID });
  await request.dispose();
}

// createRoleWithPersona —— 一个带 prompt 正文的 role，跟 owner 在 /admin/prompts + /admin/roles
// 上做的是同一件事。
async function createRoleWithPersona(
  request: APIRequestContext, csrf: string,
): Promise<string> {
  const backend = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
  const p = await request.post(`${backend}/api/admin/prompts`, {
    headers: { 'X-Csrftoken': csrf },
    data: { name: 'sdk-persona-body', body: `${PERSONA_MARK}. Speak plainly.` },
  });
  if (!p.ok()) throw new Error(`create prompt failed: ${p.status()}`);
  const prompt = await p.json() as { id: string };
  const r = await request.post(`${backend}/api/admin/roles`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      name: ROLE, description: 'carries a persona', greeting: '',
      prompt_id: prompt.id, corpus_uris: ['wiki://**'],
      skill_ids: [], mcp_server_ids: [], dock_buttons: [], waypoints: [],
    },
  });
  if (!r.ok()) throw new Error(`create role failed: ${r.status()}`);
  const role = await r.json() as { id: string };
  return role.id;
}
