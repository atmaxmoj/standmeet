// connector-binding-jsonata.spec.ts —— #155 §8 区 C（JSONata 绑定）目标契约（RED）。
//
// 把「声明式 JSONata 绑定」这层钉死：作者给 SaaS 官方 OpenAPI spec + 一份绑定
// （category + 每个契约 op → operationId + request/response 的 JSONata），后端在
// 装配时校验、在运行时执行——
//   request JSONata : 从契约输入构造 SaaS API body（CreateEvent → events.insert body）
//   response JSONata: 从 SaaS 响应抽出契约输出（freeBusy → CalendarContract.ListBusy []{start,end}）
//   category        : 填 connectorDepRegistry 的 "calendar" / "mail" 槽
//
// 全部 test.fixme：绑定子系统（POST /api/admin/connectors 收 spec+binding、JSONata
// 运行时、装配期校验）从零，未建。实现逐条转绿。decision #1（docs/design/connector.md
// §7）：映射语言只 JSONata 一个，response 抽取 + request 构造一个语言两向。
//
// e2e 不碰真 Google：内联 spec 的 servers 指向 job-board-mock 的 gcal 端点（已有
// /__mock/gcal/{set_busy,events,reset}），绑定把 list_busy/create_event 映射到 spec 里
// 两个 operationId。响应归一断言走 diag 端点；category 槽断言走日历消费者（booker
// 的 calendar_book 在 calendar.book 授权的 session 里装配成功）。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import {
  setMockBusy, getMockEvents, resetMockGCal, MOCK_GCAL_CREDS,
} from '@/fixtures/gcal';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'binding-jsonata@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'bindingjsonata',
  fullName: 'Binding JSONata Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

// ─── inlined sample OpenAPI 3.0 spec (calendar; servers → mock gcal) ───
// 一个最小但合法的 3.0 spec：两个 operationId（freebusy.query / events.insert）+
// 一个 oauth2 securityScheme。servers.url 指 e2e 的 gcal mock，所以运行时实打实打到
// 已有的 /__mock/gcal 端点（set_busy 喂 freebusy、events 录 insert）。
const SAMPLE_SPEC = {
  openapi: '3.0.3',
  info: { title: 'Sample Calendar', version: '1.0.0' },
  servers: [{ url: 'http://localhost:9000/__mock/gcal' }],
  paths: {
    '/freeBusy': {
      post: {
        operationId: 'freebusy.query',
        security: [{ oauth2: ['calendar.readonly'] }],
        responses: { '200': { description: 'free/busy' } },
      },
    },
    '/events': {
      post: {
        operationId: 'events.insert',
        security: [{ oauth2: ['calendar.events'] }],
        responses: { '200': { description: 'created event' } },
      },
    },
  },
  components: {
    securitySchemes: {
      oauth2: {
        type: 'oauth2',
        flows: {
          authorizationCode: {
            authorizationUrl: 'http://localhost:9000/__mock/gcal/authorize',
            tokenUrl: 'http://localhost:9000/__mock/gcal/token',
            scopes: {
              'calendar.readonly': 'read free/busy',
              'calendar.events': 'write events',
            },
          },
        },
      },
    },
  },
} as const;

// ─── inlined sample JSONata binding (request + response, both directions) ───
// list_busy.response : SaaS freeBusy 形状 → 契约 []{start,end}
//   SaaS 给 { calendars: { primary: { busy: [{ start, end }] } } }，JSONata 抽 .busy。
// create_event.request: 契约输入 {title,start,end,attendee} → SaaS events.insert body
//   JSONata 构造 { summary, start.dateTime, end.dateTime, attendees:[{email}] }。
const SAMPLE_BINDING = {
  category: 'calendar',
  kind: 'openapi',
  operations: {
    list_busy: {
      op: 'freebusy.query',
      // request: 契约 (timeMin,timeMax) → SaaS body。
      request: '{ "timeMin": timeMin, "timeMax": timeMax, "items": [{ "id": "primary" }] }',
      // response: SaaS → 契约 []{start,end}。
      response: 'calendars.primary.busy.{ "start": start, "end": end }',
    },
    create_event: {
      op: 'events.insert',
      // request: 契约 (title,start,end,attendee) → SaaS events.insert body。
      request:
        '{ "summary": title, "start": { "dateTime": start }, ' +
        '"end": { "dateTime": end }, "attendees": [{ "email": attendee }] }',
      // response: SaaS → 契约 EventRef {id,url}。
      response: '{ "id": id, "url": htmlLink }',
    },
  },
} as const;

// ─── inlined bad bindings (装配期校验的四种拒因) ───
// 非法 JSONata：response 缺右括号。
const BROKEN_JSONATA_BINDING = {
  ...SAMPLE_BINDING,
  operations: {
    ...SAMPLE_BINDING.operations,
    list_busy: { ...SAMPLE_BINDING.operations.list_busy, response: 'calendars.primary.busy.{ "start": start' },
  },
} as const;
// op 不在 spec：引用一个不存在的 operationId。
const GHOST_OP_BINDING = {
  ...SAMPLE_BINDING,
  operations: {
    ...SAMPLE_BINDING.operations,
    list_busy: { ...SAMPLE_BINDING.operations.list_busy, op: 'freebusy.nonexistent' },
  },
} as const;
// 未知 category：没有对应的品类槽。
const UNKNOWN_CATEGORY_BINDING = { ...SAMPLE_BINDING, category: 'telepathy' } as const;
// 不完整：calendar 契约要求 list_busy + create_event，这里漏掉 create_event。
const INCOMPLETE_BINDING = {
  category: 'calendar', kind: 'openapi',
  operations: { list_busy: SAMPLE_BINDING.operations.list_busy },
} as const;

// ─── unbuilt binding REST helpers (target contract; §8 决策草图) ───
// POST /api/admin/connectors —— 从 spec+binding 建连接器。201 → {id}；4xx → {error}。
interface CreateResult { status: number; id?: string; error?: string }

async function createConnector(
  request: APIRequestContext, csrf: string,
  body: { spec: unknown; binding: unknown },
): Promise<CreateResult> {
  const res = await request.post(`${BACKEND}/api/admin/connectors`, {
    headers: { 'X-Csrftoken': csrf },
    data: body,
  });
  const json = await res.json().catch(() => ({})) as { id?: string; error?: string };
  return { status: res.status(), id: json.id, error: json.error };
}

// diag: 跑该连接器的 list_busy 契约 op，返回归一后的 []{start,end}。证明 response
// JSONata 把 SaaS 形状正确抽成了契约形状（不经访客会话、直查运行时输出）。
interface BusyInterval { start: string; end: string }
async function diagListBusy(
  request: APIRequestContext, csrf: string, id: string,
  timeMin: string, timeMax: string,
): Promise<{ status: number; busy: BusyInterval[] }> {
  const res = await request.post(
    `${BACKEND}/internal/diag/connector/${encodeURIComponent(id)}/list-busy`,
    { headers: { 'X-Csrftoken': csrf }, data: { timeMin, timeMax } },
  );
  const json = await res.json().catch(() => ({ busy: [] })) as { busy?: BusyInterval[] };
  return { status: res.status(), busy: json.busy ?? [] };
}

// diag: 跑该连接器的 create_event 契约 op；证明 request JSONata 把契约输入构造成了
// 正确的 SaaS body（mock 录到的 event 字段对得上）。
async function diagCreateEvent(
  request: APIRequestContext, csrf: string, id: string,
  input: { title: string; start: string; end: string; attendee: string },
): Promise<number> {
  const res = await request.post(
    `${BACKEND}/internal/diag/connector/${encodeURIComponent(id)}/create-event`,
    { headers: { 'X-Csrftoken': csrf }, data: input },
  );
  return res.status();
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

// connectAndAssemble —— 存 oauth2 凭据（spec 派生）+ 跑 mock dance 把连接器连上，
// 然后发一张 calendar.book 码 + 起访客会话，返回该会话装配出的 tool 名。
async function connectAndAssembleSession(
  request: APIRequestContext, csrf: string, id: string,
): Promise<string[]> {
  const credRes = await request.post(
    `${BACKEND}/api/admin/connectors/${encodeURIComponent(id)}/credentials`,
    { headers: { 'X-Csrftoken': csrf }, data: MOCK_GCAL_CREDS },
  );
  expect(credRes.status()).toBe(200);
  const initRes = await request.post(
    `${BACKEND}/api/admin/connectors/${encodeURIComponent(id)}/connect`,
    { headers: { 'X-Csrftoken': csrf } },
  );
  expect(initRes.status()).toBe(200);
  const { auth_url } = await initRes.json() as { auth_url: string };
  const cb = await request.get(auth_url);
  expect(cb.status()).toBe(200);

  const code = await issueCodeWithSkills(request, csrf, {
    granted_skills: ['calendar.book'],
  });
  const visitor = await issueSession(request, {
    handle: OWNER.handle, mode: 'code', code: code.code,
    visitor_name: 'Recruiter Rachel', visitor_email: 'rachel@example.com',
  });
  const diag = await request.get(`${BACKEND}/internal/diag/session`, {
    headers: { 'X-Session-Token': visitor.session_token },
  });
  expect(diag.status()).toBe(200);
  const body = await diag.json() as { tool_specs: { name: string }[] };
  return body.tool_specs.map((t) => t.name);
}

// expectRejected —— POST 一份坏 binding，断言 4xx + 错误信息匹配 + 连接器未建。
// 装配期校验的四种拒因（非法 JSONata / op 不存在 / 未知 category / 漏映）共用。
// assertResponseNormalizes —— 喂 SaaS freeBusy fixture，跑 list_busy，断言归一后的
// []{start,end} 跟喂进去的两个窗口逐一相等（response JSONata 正确抽取）。
async function assertResponseNormalizes(
  request: APIRequestContext, csrf: string, id: string,
): Promise<void> {
  const b0 = { start: future(2, 13), end: future(2, 14) };
  const b1 = { start: future(3, 9), end: future(3, 10) };
  await setMockBusy(request, [b0, b1]);
  const out = await diagListBusy(request, csrf, id, future(1, 0), future(4, 0));
  expect(out.status).toBe(200);
  expect(out.busy).toEqual([
    { start: b0.start, end: b0.end },
    { start: b1.start, end: b1.end },
  ]);
}

// assertRequestConstructs —— 跑 create_event，断言 mock 录到的 body 是 request
// JSONata 构造出的形状（summary/start/end/attendees 字段对得上）。
async function assertRequestConstructs(
  request: APIRequestContext, csrf: string, id: string,
): Promise<void> {
  const input = {
    title: 'Intro chat with Rachel',
    start: future(5, 15), end: future(5, 16),
    attendee: 'rachel@example.com',
  };
  expect(await diagCreateEvent(request, csrf, id, input)).toBe(200);
  const events = await getMockEvents(request);
  const ev = events.find((e) => e.summary === input.title);
  expect(ev, 'mock recorded the constructed event').toBeTruthy();
  expect(ev!.start.dateTime).toBe(input.start);
  expect(ev!.end.dateTime).toBe(input.end);
  expect(ev!.attendees?.map((a) => a.email)).toContain(input.attendee);
}

async function expectRejected(
  request: APIRequestContext, csrf: string, binding: unknown, errPattern: RegExp,
): Promise<void> {
  const r = await createConnector(request, csrf, { spec: SAMPLE_SPEC, binding });
  expect(r.status).toBeGreaterThanOrEqual(400);
  expect(r.status).toBeLessThan(500);
  expect(r.error ?? '').toMatch(errPattern);
  expect(r.id, 'connector not created').toBeFalsy();
}

async function initOwner(playwright: Playwright): Promise<{
  request: APIRequestContext; csrf: string;
}> {
  resetInstance();
  const request = await playwright.request.newContext({ timeout: 30_000 });
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  await resetMockGCal(request);
  return { request, csrf };
}

test.describe('connector binding · JSONata 绑定（§8 区 C）', () => {
  // RED 契约：声明式 JSONata 绑定子系统（POST /api/admin/connectors 收 spec+binding、
  // 装配期校验、运行时 request/response JSONata）未建。实现后去掉。
  test.fixme(true, 'pending #155 §8-C: declarative JSONata connector binding');

  let request: APIRequestContext;
  let csrf: string;

  test.beforeAll(async ({ playwright }) => {
    ({ request, csrf } = await initOwner(playwright));
  });
  test.afterAll(async () => { await request.dispose(); });

  // ── happy: response JSONata 把 SaaS freeBusy 归一成契约 []{start,end} ──
  test('response JSONata normalizes SaaS freeBusy into CalendarContract.ListBusy []{start,end}',
    async () => {
      const r = await createConnector(request, csrf, {
        spec: SAMPLE_SPEC, binding: SAMPLE_BINDING,
      });
      expect(r.status, r.error ?? '').toBe(201);
      expect(r.id).toBeTruthy();
      await assertResponseNormalizes(request, csrf, r.id!);
    });

  // ── happy: request JSONata 把契约输入构造成正确的 SaaS create-event body ──
  test('request JSONata constructs the SaaS events.insert body from contract input',
    async () => {
      const r = await createConnector(request, csrf, {
        spec: SAMPLE_SPEC, binding: SAMPLE_BINDING,
      });
      expect(r.status, r.error ?? '').toBe(201);
      await assertRequestConstructs(request, csrf, r.id!);
    });

  // ── happy: category "calendar" → 连接器填日历 dep 槽 → calendar_book 装配 ──
  test('binding category "calendar" fills the calendar dep slot → calendar_book assembles',
    async () => {
      const r = await createConnector(request, csrf, {
        spec: SAMPLE_SPEC, binding: SAMPLE_BINDING,
      });
      expect(r.status, r.error ?? '').toBe(201);
      const toolNames = await connectAndAssembleSession(request, csrf, r.id!);
      expect(toolNames).toContain('calendar_book');
    });

  // ── err: 非法 JSONata 表达式 → 装配期拒，连接器不建 ──
  test('invalid JSONata expression is rejected at assemble time (connector not created)',
    async () => {
      await expectRejected(request, csrf, BROKEN_JSONATA_BINDING, /jsonata|invalid|syntax/i);
    });

  // ── err: 绑定引用 spec 里不存在的 operationId → 拒 ──
  test('binding referencing an operationId not in the spec is rejected',
    async () => {
      await expectRejected(request, csrf, GHOST_OP_BINDING, /freebusy\.nonexistent|operationid|not found/i);
    });

  // ── err: 未知 category → 拒（没有这个品类槽可填） ──
  test('binding with an unknown category is rejected',
    async () => {
      await expectRejected(request, csrf, UNKNOWN_CATEGORY_BINDING, /category|telepathy|unknown/i);
    });

  // ── err: 契约 op 漏映（不完整绑定）→ 拒/标记 ──
  // calendar 契约要求 list_busy + create_event 都映上；只给一个 → 不完整。
  test('an incomplete binding (a contract op left unmapped) is rejected',
    async () => {
      await expectRejected(request, csrf, INCOMPLETE_BINDING, /create_event|unmapped|incomplete|missing/i);
    });
});
