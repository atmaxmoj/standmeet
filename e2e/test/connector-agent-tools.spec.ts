// connector-agent-tools.spec.ts —— #155 §3 第二条 consumer 路（agent=语义读操作）的
// 目标契约（RED）。design 把这条路「已定」但只 §7 注「排期随后、无契约」——本文件补它。
//
// 两条 consumer 路（connector.md §3）：
//   - 代码 consumer（booker/mailer/job-loop）→ 归一**品类契约**：连接器声明 category +
//     把操作映射到契约（CalendarContract/MailContract）。已有契约见
//     connector-binding-jsonata.spec.ts（区 C）。
//   - **agent（LLM）→ 语义读操作**：直接把 OpenAPI 操作 + 描述喂给 LLM，自己读着挑
//     （MCP/GPT-Actions 式）。**不需要绑定**，丢份 spec 就能给 agent 用（§3 + §5.1 UML
//     右支「读 operations / 语义自选（无契约）/ 直接吃 OpenAPI 操作」）。
//
// 本文件钉死 agent 路：一个 openapi 连接器（**没有** category 绑定，或在绑定**之外**）把它
// 的 operations 暴露成 agent **tools** —— LLM 按 operation 的 summary/description 选用。装配
// 进访客会话的 tool 集，名/描述来自 spec 的 operation summaries，与品类契约 cap 区分开。
//
// 覆盖 §9 agent-tool 暴露子系统（openapi operations → per-session agent tools、运行时
// 按 op 调 SaaS 注入 auth、与 caps 共用 grant/ACL 闸）。已实现，全绿（原 RED 契约已转绿）。
//
// e2e 不碰真 SaaS：内联 spec 的 servers 指向 external-mock（已有 /__mock/gcal 端点族；
// 这里复用 /__mock/gcal/events 作 SaaS API 落点 + /__mock/gcal/authorize|token 作 OAuth）。
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ 假设（design 把「op 如何变 agent tool」留得很轻 —— 下面每条都需实现时确认）：
//
//  [A1] **暴露意图开关 `expose_as_agent_tools: true`**。design 只说「丢份 spec 就能给
//       agent 用」，没说默认开还是要 opt-in。本文件假设连接器在创建时带一个显式
//       `expose_as_agent_tools` 标志 —— 这同时回答了「只有品类绑定的连接器是否泄露 raw
//       ops」（见 [A5]）。若实现选「默认对所有 openapi 连接器暴露」，把 happy 用例里的
//       标志去掉、把 [A5] 用例的断言反过来。
//
//  [A2] **tool 名 = `op_<operationId>`（snake_case，去点）**。D-3 已定「URL ↔ LLM spec 1:1、
//       tool 名 snake_case」（见 agent-skills-grant.ts 注：calendar.book → calendar_book）。
//       这里假设 operationId `events.insert` → agent tool `op_events_insert`。若实现用别的
//       前缀（如 `<connector>__events_insert`）或保留点，改 TOOL_NAME_FOR()。
//
//  [A3] **tool description = operation 的 `summary`（缺则 `description`）**。MCP/GPT-Actions
//       都用 summary 当工具描述给 LLM 选。假设 diag 的 tool_specs 行带 description 字段。
//
//  [A4] **per-op ACL = skill.allowed_tools 里列 agent-tool 名**（与 caps 同一张闸）。§3 说
//       agent 路「不需要绑定」，但 design 全局原则是「per-session grant/ACL 统一」
//       （connector.md §6 DepRegistry 全局单点闸 + memory: retrieval-vs-corpus-acl）。假设
//       一个 op 要被暴露，必须 (a) 连接器 connected 且 (b) 该 session 的 role/skill 授了这个
//       agent-tool 名。未授的 op 不进 tool 集。若实现选「连接器级粒度而非 per-op」，把
//       PARTIAL_GRANT 用例降级成「整连接器授/不授」。
//
//  [A5] **纯品类绑定连接器不泄 raw ops**。design §3 把两条路并列，未明说「装了品类绑定的
//       连接器是否也自动把 raw ops 暴露给 agent」。本文件假设 **不自动泄露** —— 品类绑定
//       连接器只给 agent 暴露归一后的品类 cap（calendar_book），不暴露 raw `op_*`，除非也
//       显式带 `expose_as_agent_tools`。这条假设最需确认（见对应用例）。
//
//  [A6] **运行时入口 = diag `/api/admin/diag/connector/{id}/agent-call`**，按 op + args 调
//       SaaS、注入 auth、回原始（未归一）响应 —— 因为 agent 路无契约、无 response JSONata，
//       LLM 直接消费 SaaS 形状。复用 connector-binding 的 diag 命名习惯。
// ─────────────────────────────────────────────────────────────────────────────

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import {
  AGENT_OWNER, MOCK_OAUTH2_SCHEME, createAndConnect, diagAgentCall,
  disconnectConnector, initOwner, sessionToolNames, sessionToolSpecs, startSession,
} from '@/fixtures/connector-agent-rig';
import { scriptMockToolCall, sendAndDrain } from '@/fixtures/mock-llm-script';

test.use({ ownerCredentials: { email: AGENT_OWNER.email, password: AGENT_OWNER.password } });

// [A2] operationId → agent-tool 名映射（去点 → snake_case，加 `op_` 前缀）。
function TOOL_NAME_FOR(operationId: string): string {
  return `op_${operationId.replace(/\./g, '_')}`;
}

// ─── inlined sample OpenAPI 3.0 spec（CRM-ish；servers → mock SaaS）───
// 一个最小但合法的 3.0 spec：三个带 summary 的 operationId + 一个 oauth2 securityScheme。
// servers.url 指 e2e 的 mock，所以运行时实打实打到已有 /__mock/gcal/events 端点。
// 故意**不是** calendar 品类 —— 这条是 agent 路，连接器不声明 category，LLM 按 summary 选。
const AGENT_SPEC = {
  openapi: '3.0.3',
  info: { title: 'Acme CRM', version: '1.0.0' },
  servers: [{ url: 'http://external-mock:9000/crm' }],
  paths: {
    '/contacts': {
      get: {
        operationId: 'contacts.list',
        summary: 'List CRM contacts',
        description: 'Return the owner\'s CRM contacts.',
        security: [{ oauth2: ['contacts.read'] }],
        responses: { '200': { description: 'contacts' } },
      },
    },
    '/contacts/search': {
      post: {
        operationId: 'contacts.search',
        summary: 'Search contacts by query',
        security: [{ oauth2: ['contacts.read'] }],
        responses: { '200': { description: 'matches' } },
      },
    },
    '/deals': {
      post: {
        operationId: 'deals.create',
        summary: 'Create a sales deal',
        security: [{ oauth2: ['deals.write'] }],
        responses: { '200': { description: 'created' } },
      },
    },
  },
  components: { securitySchemes: MOCK_OAUTH2_SCHEME },
} as const;

// 全部三个 op 的 agent-tool 名（断 happy 暴露 + 区分品类 cap 用）。
const ALL_OP_TOOLS = [
  TOOL_NAME_FOR('contacts.list'),
  TOOL_NAME_FOR('contacts.search'),
  TOOL_NAME_FOR('deals.create'),
];

// ─── inlined calendar spec WITH a category binding（[A5] 对照：纯品类连接器不泄 raw ops）───
// 跟 connector-binding-jsonata.spec.ts 同构的 calendar spec + binding，但**不带**
// expose_as_agent_tools —— 用来断言它只暴露归一 cap（calendar_book），不泄 op_* raw tools。
const CALENDAR_SPEC = {
  openapi: '3.0.3',
  info: { title: 'Sample Calendar', version: '1.0.0' },
  servers: [{ url: 'http://external-mock:9000/google-calendar' }],
  paths: {
    '/freeBusy': {
      post: {
        operationId: 'freebusy.query', summary: 'Query free/busy',
        security: [{ oauth2: ['calendar.readonly'] }],
        responses: { '200': { description: 'free/busy' } },
      },
    },
    '/events': {
      post: {
        operationId: 'events.insert', summary: 'Insert event',
        security: [{ oauth2: ['calendar.events'] }],
        responses: { '200': { description: 'created' } },
      },
    },
  },
  components: {
    securitySchemes: {
      oauth2: {
        type: 'oauth2',
        flows: {
          authorizationCode: {
            authorizationUrl: 'http://localhost:9000/google-oauth/auth',
            tokenUrl: 'http://external-mock:9000/google-oauth/token',
            scopes: { 'calendar.readonly': 'read', 'calendar.events': 'write' },
          },
        },
      },
    },
  },
} as const;

const CALENDAR_BINDING = {
  category: 'calendar',
  kind: 'openapi',
  operations: {
    list_busy: {
      op: 'freebusy.query',
      request: '{ "timeMin": timeMin, "timeMax": timeMax, "items": [{ "id": "primary" }] }',
      response: 'calendars.primary.busy.{ "start": start, "end": end }',
    },
    create_event: {
      op: 'events.insert',
      request: '{ "summary": title, "start": { "dateTime": start }, "end": { "dateTime": end } }',
      response: '{ "id": id, "url": htmlLink }',
    },
  },
} as const;

// raw op names the calendar connector would expose IF it leaked them (must NOT appear).
const CALENDAR_RAW_OP_TOOLS = [
  TOOL_NAME_FOR('freebusy.query'),
  TOOL_NAME_FOR('events.insert'),
];

// 「装 → 连 → 授权 → 起会话」那套器材住在 fixtures/connector-agent-rig.ts。
// 拆出去是因为这个文件到了 350 行的闸，而同一套器材现在有第二个使用者
// （connector-agent-tool-names.spec.ts）。

test.describe('connector · agent-tool exposure (§3 second consumer path: agent = semantic read ops)', () => {
  // 覆盖 openapi operations → per-session agent tools 子系统（design §3 第二消费路径）。
  // 已实现，绿（原为 RED 契约）。

  let request: APIRequestContext;
  let csrf: string;

  test.beforeEach(async ({ playwright }) => {
    ({ request, csrf } = await initOwner(playwright));
  });
  test.afterEach(async () => { await request.dispose(); });

  // happy: connected openapi 连接器（[A1] expose_as_agent_tools）→ 它的 operations 进会话
  // tool 集，名 [A2] / 描述 [A3] 来自 spec 的 operation summaries。
  test('connected openapi connector exposes its operations as agent tools (names + descriptions from spec summaries)',
    async () => {
      await createAndConnect(request, csrf, { spec: AGENT_SPEC, expose_as_agent_tools: true });
      const session = await startSession(request, csrf, ALL_OP_TOOLS);
      const specs = await sessionToolSpecs(request, session.session_token);
      const byName = new Map(specs.map((t) => [t.name, t]));

      // [A2] 三个 op 都暴露成 agent tool。
      for (const name of ALL_OP_TOOLS) {
        expect(byName.has(name), `agent tool ${name} exposed`).toBe(true);
      }
      // [A3] description 来自 operation summary（LLM 据此语义选用）。
      expect(byName.get(TOOL_NAME_FOR('contacts.list'))?.description).toMatch(/list crm contacts/i);
      expect(byName.get(TOOL_NAME_FOR('deals.create'))?.description).toMatch(/create a sales deal/i);
    });

  // happy: op_* 是 raw-op tool，区别于归一品类 cap。无 category 绑定 → 无 calendar_book。
  test('agent tools are distinct from category-contract caps (raw ops, not a normalized category cap)',
    async () => {
      await createAndConnect(request, csrf, { spec: AGENT_SPEC, expose_as_agent_tools: true });
      const session = await startSession(request, csrf, ALL_OP_TOOLS);
      const names = await sessionToolNames(request, session.session_token);

      expect(names, 'raw op tools present').toEqual(expect.arrayContaining(ALL_OP_TOOLS));
      // 无 category 绑定 → 不应冒出任何归一品类 cap。
      expect(names, 'no normalized category cap leaked from an agent-only connector')
        .not.toContain('calendar_book');
    });

  // happy: agent（mock-llm-script）选 op_contacts_search（按 summary）→ 运行时注入 auth 调
  // SaaS（[A6] diag 直跑证通路）→ 原始响应回 agent，turn 不崩。
  test('the agent invokes an agent tool → runtime calls the SaaS (auth-injected) → result returns to the agent',
    async () => {
      const id = await createAndConnect(request, csrf, { spec: AGENT_SPEC, expose_as_agent_tools: true });
      const session = await startSession(request, csrf, ALL_OP_TOOLS);

      // 先用 diag 直跑一次证明运行时通路（auth 注入 + 真打 SaaS mock）。
      const direct = await diagAgentCall(request, csrf, id, 'contacts.search', { query: 'rachel' });
      expect(direct, 'runtime executed the op against the SaaS').toBe(200);

      // 再走 LLM 脚本：mock 选 op_contacts_search，turn 不崩。脚本 keyword 塞进这一
      // 条消息(scriptTag),mock 按 Contains 匹配,别的 test 的 turn 命中不了。
      const tag = await scriptMockToolCall(request, {
        name: TOOL_NAME_FOR('contacts.search'),
        args: { query: 'rachel' },
      });
      await sendAndDrain(request, session, `Find Rachel in the CRM${tag}`);
    });
});

test.describe('connector · agent-tool exposure · ACL/gating (§3 + §6 single global gate)', () => {
  // 同一张 grant/ACL 闸管 agent tools：per-op grant、纯品类连接器不泄 raw ops、断开即消失。

  let request: APIRequestContext;
  let csrf: string;

  test.beforeEach(async ({ playwright }) => {
    ({ request, csrf } = await initOwner(playwright));
  });
  test.afterEach(async () => { await request.dispose(); });

  // ACL/gating [A4]: 只 grant contacts.list；contacts.search / deals.create 未授 → 不进 tool 集。
  test('agent-tool exposure respects per-session grant/ACL (an ungranted op is not exposed)',
    async () => {
      await createAndConnect(request, csrf, { spec: AGENT_SPEC, expose_as_agent_tools: true });

      // 只授 contacts.list 这一个 agent tool。
      const granted = [TOOL_NAME_FOR('contacts.list')];
      const session = await startSession(request, csrf, granted);
      const names = await sessionToolNames(request, session.session_token);

      expect(names, 'granted op exposed').toContain(TOOL_NAME_FOR('contacts.list'));
      expect(names, 'ungranted op not exposed').not.toContain(TOOL_NAME_FOR('contacts.search'));
      expect(names, 'ungranted op not exposed').not.toContain(TOOL_NAME_FOR('deals.create'));
    });

  // [A5] ⚠️最需确认：纯品类绑定连接器（无 expose_as_agent_tools）只暴露归一 cap
  // calendar_book，不泄 raw op_*。若 design 选「openapi 一律暴露 raw ops」，反转下面断言。
  test('a category-only connector does NOT leak raw ops as agent tools — only the category cap [ASSUMPTION A5]',
    async () => {
      // 无 expose_as_agent_tools —— 纯品类绑定连接器。
      await createAndConnect(request, csrf, { spec: CALENDAR_SPEC, binding: CALENDAR_BINDING });

      // 授归一品类 cap + 它的 raw ops（若实现泄露，raw ops 会因被授而出现 → 断言抓到）。
      const session = await startSession(request, csrf, ['calendar.book', ...CALENDAR_RAW_OP_TOOLS]);
      const names = await sessionToolNames(request, session.session_token);

      expect(names, 'normalized category cap present').toContain('calendar_book');
      for (const raw of CALENDAR_RAW_OP_TOOLS) {
        expect(names, `raw op ${raw} NOT leaked from a category-only connector`).not.toContain(raw);
      }
    });

  // ── err: 连接器 disconnect → 它的 agent tools 消失（与其它 cap 同样被闸）──
  // connected → op_* 暴露；disconnect → 经全局单点闸（dependency.connected=false）全部消失。
  test('a disconnected connector — its agent tools disappear (gated like everything else)',
    async () => {
      const id = await createAndConnect(request, csrf, { spec: AGENT_SPEC, expose_as_agent_tools: true });

      // connected：暴露。
      const before = await startSession(request, csrf, ALL_OP_TOOLS);
      expect(await sessionToolNames(request, before.session_token))
        .toEqual(expect.arrayContaining(ALL_OP_TOOLS));

      // disconnect → 新会话里 agent tools 全没（gated）。
      await disconnectConnector(request, csrf, id);
      const after = await startSession(request, csrf, ALL_OP_TOOLS);
      const names = await sessionToolNames(request, after.session_token);
      for (const name of ALL_OP_TOOLS) {
        expect(names, `agent tool ${name} gated after disconnect`).not.toContain(name);
      }
    });
});
