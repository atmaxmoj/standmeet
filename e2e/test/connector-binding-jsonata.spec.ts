// connector-binding-jsonata.spec.ts —— #155 §8 区 C（声明式 JSONata 绑定）。作者给 SaaS spec +
// 绑定（category + 每契约 op → operationId + request/response JSONata），后端装配期校验 + 运行时
// 执行：request JSONata 从契约输入构 SaaS body；response JSONata 从 SaaS 响应抽契约输出；category
// 填 "calendar"/"mail" 槽。e2e 不碰真 Google：内联 spec 的 servers 指 external-mock 的 gcal 端点；
// 响应归一断言走 diag 端点，category 槽断言走 booker 的 calendar_book 装配。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import {
  setMockBusy, getMockEvents, resetMockGCal, MOCK_GCAL_CREDS,
} from '@/fixtures/gcal';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { issueSession } from '@/fixtures/visitor';
import {
  SAMPLE_SPEC, SAMPLE_BINDING, NULL_REQUIRED_FIELD_BINDING, NESTED_ARRAY_BINDING,
  EXTRA_OP_BINDING, BROKEN_JSONATA_BINDING, GHOST_OP_BINDING, UNKNOWN_CATEGORY_BINDING,
  INCOMPLETE_BINDING,
} from '@/fixtures/connector-jsonata';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'binding-jsonata@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'bindingjsonata',
  fullName: 'Binding JSONata Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });


// ─── unbuilt binding REST helpers (target contract; §8 决策草图) ───
// POST /api/admin/connectors —— 从 spec+binding 建连接器。201 → {id}；4xx → {error}。
interface CreateResult { status: number; id?: string; error?: string }

async function createConnector(
  request: APIRequestContext, csrf: string, body: { spec: unknown; binding: unknown },
): Promise<CreateResult> {
  const res = await request.post(`${BACKEND}/api/admin/connectors`, { headers: { 'X-Csrftoken': csrf }, data: body });
  const json = await res.json().catch(() => ({})) as {
    id?: string; error?: string | { message?: string };
  };
  const err = typeof json.error === 'string' ? json.error : json.error?.message;
  return { status: res.status(), id: json.id, error: err };
}

// diag: 跑该连接器的 list_busy 契约 op，返回归一后的 []{start,end}。证明 response
// JSONata 把 SaaS 形状正确抽成了契约形状（不经访客会话、直查运行时输出）。
interface BusyInterval { start: string; end: string }
async function diagListBusy(
  request: APIRequestContext, csrf: string, id: string, timeMin: string, timeMax: string,
): Promise<{ status: number; busy: BusyInterval[] }> {
  const res = await request.post(`${BACKEND}/api/admin/diag/connector/${encodeURIComponent(id)}/list-busy`,
    { headers: { 'X-Csrftoken': csrf }, data: { timeMin, timeMax } });
  const json = await res.json().catch(() => ({ busy: [] })) as { busy?: BusyInterval[] };
  return { status: res.status(), busy: json.busy ?? [] };
}

// ─── inlined mock-shape control (assumed §8-C mock extensions; NOT in fixtures) ───
// gcal.ts 的 setMockBusy 喂的是理想 freeBusy 形状。下面的运行时降级测试需要喂
// 「畸形/缺字段/数组」形状，所以这里直接打 mock 的（假设新增的）形状控制端点。
// 假设 external-mock 在 /__mock/gcal 下加：
//   POST /__mock/gcal/set_freebusy_raw  { body }  —— 让下次 freeBusy 原样回这个 JSON
//   POST /__mock/gcal/set_event_shape   { shape:'object'|'array' } —— 控 events.insert 回形
// （fixtures 不动；实现 mock 时落这两个端点，落了把这些 helper 收编进 gcal.ts。）
const MOCK = process.env['MOCK_BASE_URL'] ?? 'http://localhost:9000';

// 让 mock 下次 freeBusy 原样回这坨 JSON（用来喂缺字段/SHAPE 不符的响应）。
async function setMockFreeBusyRaw(request: APIRequestContext, body: unknown): Promise<void> {
  const res = await request.post(`${MOCK}/__mock/gcal/set_freebusy_raw`, { data: { body } });
  expect(res.status(), 'mock set_freebusy_raw').toBe(200);
}

// 让 mock 的 events.insert 回 object（正常）或 array（SHAPE 不符）。
async function setMockEventShape(request: APIRequestContext, shape: 'object' | 'array'): Promise<void> {
  const res = await request.post(`${MOCK}/__mock/gcal/set_event_shape`, { data: { shape } });
  expect(res.status(), 'mock set_event_shape').toBe(200);
}

// diag create-event 但返回 {status, ref}（不抛、不只看 200）——给降级/拒绝测试用。
interface EventRef { id?: string; url?: string }
async function diagCreateEventResult(
  request: APIRequestContext, csrf: string, id: string,
  input: { title?: string; start: string; end: string; attendee: string },
): Promise<{ status: number; ref: EventRef; error?: string }> {
  const res = await request.post(`${BACKEND}/api/admin/diag/connector/${encodeURIComponent(id)}/create-event`,
    { headers: { 'X-Csrftoken': csrf }, data: input });
  const json = await res.json().catch(() => ({})) as { id?: string; url?: string; error?: string };
  return { status: res.status(), ref: { id: json.id, url: json.url }, error: json.error };
}

// createOK —— POST 一份 binding，断言 201，返回连接器 id。装配本身不是被测点的
// （happy/runtime）测试共用，省掉每条重复的 status 断言。
async function createOK(request: APIRequestContext, csrf: string, binding: unknown): Promise<string> {
  const r = await createConnector(request, csrf, { spec: SAMPLE_SPEC, binding });
  expect(r.status, r.error ?? '').toBe(201);
  expect(r.id).toBeTruthy();
  return r.id!;
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

  const code = await issueCodeWithSkills(request, csrf, { granted_skills: ['calendar.book'] });
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
  expect(out.busy).toEqual([{ start: b0.start, end: b0.end }, { start: b1.start, end: b1.end }]);
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
  expect((await diagCreateEventResult(request, csrf, id, input)).status).toBe(200);
  const events = await getMockEvents(request);
  const ev = events.find((e) => e.summary === input.title);
  expect(ev, 'mock recorded the constructed event').toBeTruthy();
  expect(ev!.start.dateTime).toBe(input.start);
  expect(ev!.end.dateTime).toBe(input.end);
  expect(ev!.attendees?.map((a) => a.email)).toContain(input.attendee);
}

// assertGracefulEmpty —— 喂一坨「缺 calendars.primary.busy 路径」的 freeBusy，跑
// list_busy，断言 200 + busy 优雅成 []（不 5xx、不漏 null/garbage）。缺字段/空对象共用。
async function assertGracefulEmpty(request: APIRequestContext, csrf: string, raw: unknown): Promise<void> {
  const id = await createOK(request, csrf, SAMPLE_BINDING);
  await setMockFreeBusyRaw(request, raw);
  const out = await diagListBusy(request, csrf, id, future(1, 0), future(4, 0));
  expect(out.status, 'missing field/empty response must not 5xx').toBe(200);
  expect(out.busy, 'degrades to empty, no null/garbage leak').toEqual([]);
}

// assertCleanDegrade —— events.insert 回 array（object 期望）；断言不 5xx，且
// 要么友好 4xx，要么 200 但 EventRef 干净为空（不把 array garbage 回给 consumer）。
async function assertCleanDegrade(request: APIRequestContext, csrf: string): Promise<void> {
  const id = await createOK(request, csrf, SAMPLE_BINDING);
  await setMockEventShape(request, 'array');
  const out = await diagCreateEventResult(request, csrf, id, {
    title: 'Shape mismatch probe', start: future(6, 15), end: future(6, 16), attendee: 'rachel@example.com',
  });
  expect(out.status, 'shape mismatch must not 5xx').toBeLessThan(500);
  if (out.status === 200) {
    expect(out.ref.id, 'id must not be array garbage').toBeFalsy();
    expect(out.ref.url, 'url is empty likewise').toBeFalsy();
  } else {
    expect(out.error ?? '').toMatch(/shape|mapping|response|unexpected/i);
  }
}

// assertPreflightReject —— request JSONata 必填 summary 求值 null；断言 pre-flight
// 友好拒（4xx，非 5xx），且 mock 没录到畸形 event（没真发出去）。
async function assertPreflightReject(request: APIRequestContext, csrf: string): Promise<void> {
  const id = await createOK(request, csrf, NULL_REQUIRED_FIELD_BINDING);
  await setMockEventShape(request, 'object');
  const out = await diagCreateEventResult(request, csrf, id, {
    title: 'ignored by binding', start: future(7, 15), end: future(7, 16), attendee: 'rachel@example.com',
  });
  expect(out.status, 'null required field must not 5xx').toBeLessThan(500);
  expect(out.status, 'null required field must be rejected pre-flight').toBeGreaterThanOrEqual(400);
  expect(out.error ?? '').toMatch(/summary|required|null|invalid|body/i);
  const events = await getMockEvents(request);
  expect(events.find((e) => e.summary === null as unknown as string), 'no malformed event recorded').toBeFalsy();
}

// assertNestedArrayMaps —— 喂 periods[].interval{from,to}，跑 list_busy，断言嵌套映射 +
// 重命名抽成契约 []{start,end}（证明 JSONata 构造力超出扁平路径）。
async function assertNestedArrayMaps(request: APIRequestContext, csrf: string): Promise<void> {
  const id = await createOK(request, csrf, NESTED_ARRAY_BINDING);
  const i0 = { from: future(2, 13), to: future(2, 14) };
  const i1 = { from: future(3, 9), to: future(3, 10) };
  await setMockFreeBusyRaw(request, { calendars: { primary: { periods: [{ interval: i0 }, { interval: i1 }] } } });
  const out = await diagListBusy(request, csrf, id, future(1, 0), future(4, 0));
  expect(out.status).toBe(200);
  expect(out.busy).toEqual([{ start: i0.from, end: i0.to }, { start: i1.from, end: i1.to }]);
}

// assertExtraOpTolerated —— binding 多绑一个 consumer 不要的 op（cancel_event）；断言
// 照常装配（calendar_book 冒出）且核心 list_busy 没被干扰。
async function assertExtraOpTolerated(request: APIRequestContext, csrf: string): Promise<void> {
  const id = await createOK(request, csrf, EXTRA_OP_BINDING);
  const toolNames = await connectAndAssembleSession(request, csrf, id);
  expect(toolNames).toContain('calendar_book');
  await assertResponseNormalizes(request, csrf, id);
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

test.describe('connector binding · JSONata binding (§8 area C)', () => {
  // #155 §8-C 已落地：声明式 JSONata 绑定子系统（POST /api/admin/connectors 收 spec+binding、
  // 装配期校验、运行时 request/response JSONata）。

  let request: APIRequestContext;
  let csrf: string;

  test.beforeAll(async ({ playwright }) => {
    ({ request, csrf } = await initOwner(playwright));
  });
  test.afterAll(async () => { await request.dispose(); });

  // ── happy: response JSONata 把 SaaS freeBusy 归一成契约 []{start,end} ──
  test('response JSONata normalizes SaaS freeBusy into CalendarContract.ListBusy []{start,end}',
    async () => {
      const id = await createOK(request, csrf, SAMPLE_BINDING);
      await assertResponseNormalizes(request, csrf, id);
    });

  // ── happy: request JSONata 把契约输入构造成正确的 SaaS create-event body ──
  test('request JSONata constructs the SaaS events.insert body from contract input',
    async () => {
      const id = await createOK(request, csrf, SAMPLE_BINDING);
      await assertRequestConstructs(request, csrf, id);
    });

  // ── happy: category "calendar" → 连接器填日历 dep 槽 → calendar_book 装配 ──
  test('binding category "calendar" fills the calendar dep slot → calendar_book assembles',
    async () => {
      const id = await createOK(request, csrf, SAMPLE_BINDING);
      const toolNames = await connectAndAssembleSession(request, csrf, id);
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

  // ─────────────────────────────────────────────────────────────────────────
  // §8-C RUNTIME branches —— 装配过了，运行时 SaaS 不按理想形状来时怎么优雅降级。
  // 上面那批是 assemble-time 校验；这批专钉 runtime（缺字段 / shape 不符 / 非法请求体
  // / 嵌套数组映射 / 多映 op）。test 体全抽进顶层 helper，保 describe callback 不超长。
  // ─────────────────────────────────────────────────────────────────────────

  // ── err·runtime: response 读的字段缺失 → 优雅成 []（不崩、不 500） ──
  // mock 喂一个没有 calendars.primary.busy 路径的 freeBusy；缺失路径求值 undefined → []。
  test('runtime missing field: freeBusy without calendars.primary.busy → ListBusy returns [] (graceful, no 5xx)',
    async () => {
      await assertGracefulEmpty(request, csrf, { kind: 'calendar#freeBusy', calendars: { primary: {} } });
    });

  // ── err·runtime: 完全空对象响应 {} → 优雅成 []（一路 undefined，不 throw） ──
  test('runtime null/empty response: freeBusy returns {} → ListBusy returns [] (graceful)',
    async () => {
      await assertGracefulEmpty(request, csrf, {});
    });

  // ── err·runtime: 响应 SHAPE 不符（array where object 期望）→ 兜底降级，不回 garbage ──
  // events.insert 的 response 取 .id/.htmlLink（期望 object），但 mock 回 array → EventRef
  // 空/清晰降级；HTTP 不 5xx，不把 garbage 原样回给 consumer。
  test('runtime shape mismatch: events.insert returns an array (object expected) → EventRef degrades cleanly (no garbage, no 5xx)',
    async () => {
      await assertCleanDegrade(request, csrf);
    });

  // ── err·runtime: request JSONata 求出必填字段 null → pre-flight 拒/友好报错 ──
  // request 把 summary 映到契约输入没有的字段 → 求值 null。不发畸形请求；pre-flight 拒。
  test('runtime invalid request body: required summary evaluates to null → create rejected pre-flight (friendly, no malformed call)',
    async () => {
      await assertPreflightReject(request, csrf);
    });

  // ── happy·runtime: 嵌套数组 + 重命名映射 → 正确抽成 []{start,end} ──
  // 证明 JSONata 构造力超出扁平路径：periods[].interval.{from,to} → {start,end}。
  test('runtime nested array mapping: periods[].interval{from,to} maps correctly into []{start,end}',
    async () => {
      await assertNestedArrayMaps(request, csrf);
    });

  // ── happy: 多映一个 consumer 不要的 op（extra op）→ 容忍（忽略），照常装配 ──
  // booker 只认 list_busy + create_event；多绑一个 cancel_event 不应阻止装配。
  test('binding maps an extra op the consumer does not need → tolerated (ignored), connector still assembles',
    async () => {
      await assertExtraOpTolerated(request, csrf);
    });
});
