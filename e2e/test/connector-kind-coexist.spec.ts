// connector-kind-coexist.spec.ts —— #155 §1「kind 轴」缺测分支：**一个品类、两种 kind**。
//
// 设计 §1：一个品类可被两种 kind 满足 —— `calendar` = Google(openapi) 或 CalDAV(protocol)。
// 既有 e2e（connector-provider-agnostic.spec.ts）只证「装一个非-gcal provider，booker 一行不改」，
// 但**没测「两个 calendar 连接器同时配置」时的共存/选槽/替换**：
//   - 谁填「calendar」品类槽？两个都 connected 时 booker 落到哪个 provider？
//   - 连第二个 → 槽位怎么移交？disconnect active 的那个 → 槽位回退还是复闸？
//
// ⚠️ 设计没钉死「一个品类槽多个 kind 都 connected」时的归属规则（§1 只说「可被两种满足」，
// §3 dep-gating 经 connectorDepRegistry 命名 provider，但没说多 provider 仲裁）。本契约**断最合理的**：
//
//   ┌─ 假设的 SLOT-RESOLUTION RULE（实现/owner 确认这条）────────────────────────────┐
//   │ 1. 一个品类槽**同一时刻只有一个 ACTIVE 连接器**。owner 显式选哪个 active。       │
//   │ 2. 其余同品类连接器是 **configured-but-inactive**（可 connected、有凭据，但不填槽）。│
//   │ 3. consumer（booker）永远只对 **ACTIVE** 的 provider 跑契约；inactive 的不收 event。│
//   │ 4. 连第二个 calendar 连接器**不自动抢槽** —— 要 owner 显式 set-active 才移交         │
//   │    （避免「连一下就把生产日历换掉」的意外）。set-active 后 booker 落到新 provider。 │
//   │ 5. dep-gating：calendar.book 的闸 = 「**至少一个 ACTIVE 连接器 connected**」，         │
//   │    **不绑定具体 provider**。active 在两个 connected 间切换不影响 gate 开。           │
//   │ 6. disconnect **active** 的那个：**回退到另一个 connected 的同品类连接器**（自动     │
//   │    promote 成 active），槽位**不复闸**（只要还有 connected 的候选）。仅当**无任何      │
//   │    connected 候选**时才 re-gate。← 这条最不确定，标成 ASSUMPTION，实现可改成「不回退、 │
//   │    直接 re-gate、要 owner 重新 set-active」，两种都在下面留了断言注释。              │
//   └──────────────────────────────────────────────────────────────────────────────┘
//
// 接口对齐 §8：REST POST /api/admin/connectors（openapi `{spec,binding}` | protocol
//   `{kind,protocol,category}` → 201 {id}）；…/{id}/{connect,disconnect,status}；
//   GET /api/admin/connectors（{connectors:[…]}）。新增**槽位选择**端（设计未列，本契约提议）：
//   POST …/{id}/activate（把这个连接器设为其品类的 active）；status 多回 `active` 布尔。
//   capabilities.ts dependency.connected 驱动全局单点闸（§6）。
//
// TDD 红契约：全 test.fixme（设计 §8「~30-50 条红测，实现逐区转绿」）。红在「同品类两 kind
// 共存 + 单 active 槽仲裁 + 切换/回退」这条尚未建的路上。
//
// 不碰 e2e/fixtures/ —— 复用既有 fixture（test/admin/instance/capabilities/agent-skills-grant/
// visitor/mock-llm-script），共存特有的 helper 全 inline 在本文件末尾。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { findCapability } from '@/fixtures/capabilities';
import { issueCodeWithSkills, expectCalendarBookExposed } from '@/fixtures/agent-skills-grant';
import { issueSession } from '@/fixtures/visitor';
import { scriptMockToolCall, sendAndDrain } from '@/fixtures/mock-llm-script';
import { SAMPLE_SPEC, SAMPLE_BINDING } from '@/fixtures/connector-jsonata';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
// mock 控制面（events / fail / reset）走 localhost；backend 容器内打 caldav 用 service-name。
const CALDAV_MOCK = process.env['CALDAV_MOCK_URL'] ?? 'http://localhost:9000';
const GCAL_MOCK = process.env['GCAL_MOCK_URL'] ?? 'http://localhost:9000';
const CALDAV_API = 'http://job-board-mock:9000';

const OWNER = {
  email: 'kind-coexist@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'kcowner',
  fullName: 'Kind Coexist Owner',
};

function futureSlot(daysAhead: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) { // 默认 policy 只允许工作日
    d.setUTCDate(d.getUTCDate() + 1);
  }
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

test.describe('connector · one category, two kinds coexisting (§1 kind-axis branch)', () => {
  // #155 §1 已落地：同品类双 kind（Google openapi + CalDAV protocol）共存 + 单 active 槽仲裁 +
  // 切换 + disconnect-active 回退（promoteFallback）。

  let request: APIRequestContext;
  test.beforeAll(async ({ playwright }) => {
    request = await initOwner(playwright);
  });
  test.afterAll(async () => { await request?.dispose(); });

  // ⭐ 共存 + 默认 active：装 BOTH（Google openapi + CalDAV protocol）calendar 连接器都 connected。
  // 断「同一时刻只有一个 active」、booker 落到 active 的那个、另一个不收 event。
  test('Google(openapi) + CalDAV(protocol) both fill calendar → exactly one active, booker only lands on active',
    async () => { await runBothConnectedOneActive(request); });

  // switch/replace：active 从 Google 切到 CalDAV → 槽位移交，booker 落到新 active。
  // 断「连第二个不自动抢槽，要显式 activate」+ 切换后旧 active 不再收 event。
  test('explicit activate switches the active connector → slot handover, booker lands on the new provider (old stops receiving)',
    async () => { await runSwitchActive(request); });

  // dep-gating（不绑 provider）：两个都 configured 但都 disconnect → re-gate；
  // 任一变 active+connected → un-gate。断闸条件 = 「至少一个 ACTIVE connected」。
  test('dep-gating binds to "at least one active connected", not a specific provider',
    async () => { await runGatingNotProviderBound(request); });

  // disconnect ACTIVE → 回退到另一个 connected 的同品类连接器（ASSUMPTION，见顶部 rule#6）。
  // 实现若选「不回退、直接 re-gate」，把 EXPECT-FALLBACK 段换成 EXPECT-REGATE 段。
  test('disconnect the current active → fall back to another connected candidate (no re-gate) [assumption]',
    async () => { await runDisconnectActiveFallback(request); });

  // 边界：断开 inactive 的那个不影响 active 槽（共存里 inactive 是「备胎」，断它无副作用）。
  test('disconnect an inactive candidate → active slot + booker unaffected',
    async () => { await runDisconnectInactiveNoop(request); });
});

// ─── test bodies (top-level so the describe callback stays short) ───

async function runBothConnectedOneActive(request: APIRequestContext): Promise<void> {
  const { csrf } = await login(request, OWNER.email, OWNER.password);

  // 两个 calendar 连接器都配置 + connected，但 owner 把 Google 设为 active。
  const gcal = await connectGoogleCalendar(request, csrf);     // openapi
  const caldav = await connectCalDAVCalendar(request, csrf);   // protocol
  await activateConnector(request, csrf, gcal.id);

  // 同品类两个连接器都列出，但 status.active 恰一个 true。
  const cals = await listConnectors(request, csrf, 'calendar');
  expect(cals.length, 'two calendar connectors coexist (config not mutually exclusive)').toBe(2);
  const actives = cals.filter((c) => c.active);
  expect(actives.length, 'exactly one active fills the slot at a time').toBe(1);
  expect(actives[0]!.id, 'owner-selected Google is active').toBe(gcal.id);

  // dep-gating：有 active 且 connected → calendar.book 解闸（不绑具体 provider）。
  const cap = await findCapability(request, csrf, 'calendar.book');
  expect(cap?.dependency?.connected, 'at least one active connected → slot connected').toBe(true);

  // 真 book → event 落在 ACTIVE（Google），CalDAV（inactive）收不到。
  const start = futureSlot(7, 14);
  const visitor = await codeVisitor(request, csrf, 'Recruiter Rachel', 'rachel@example.com');
  await expectCalendarBookExposed(request, visitor.session_token, true);
  await bookViaChat(request, visitor, start);

  const onGoogle = await getProviderEvents(request, 'gcal', gcal.id);
  const onCalDAV = await getProviderEvents(request, 'caldav', caldav.id);
  expect(onGoogle, 'event lands on ACTIVE (Google openapi)').toHaveLength(1);
  expect(onGoogle[0]!.start).toBe(start);
  expect(onCalDAV, 'inactive (CalDAV) does not receive the booker event').toHaveLength(0);
}

async function runSwitchActive(request: APIRequestContext): Promise<void> {
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  const gcal = await connectGoogleCalendar(request, csrf);
  const caldav = await connectCalDAVCalendar(request, csrf);

  // 先 Google active，验「连第二个（CalDAV）不自动抢槽」。
  await activateConnector(request, csrf, gcal.id);
  let cals = await listConnectors(request, csrf, 'calendar');
  expect(activeId(cals), 'connecting the second does not auto-seize the slot — Google still active').toBe(gcal.id);

  // 显式把 active 切到 CalDAV。
  await activateConnector(request, csrf, caldav.id);
  cals = await listConnectors(request, csrf, 'calendar');
  expect(activeId(cals), 'after set-active the slot hands over to CalDAV').toBe(caldav.id);
  expect(cals.filter((c) => c.active).length, 'still exactly one active after the switch').toBe(1);

  // gate 不受切换影响（不绑具体 provider）。
  const cap = await findCapability(request, csrf, 'calendar.book');
  expect(cap?.dependency?.connected, 'switching active does not affect the gate staying open').toBe(true);

  // booker 现在落到新 active（CalDAV），Google 收不到。
  const start = futureSlot(8, 15);
  const visitor = await codeVisitor(request, csrf, 'Switcher Sam', 'sam@example.com');
  await bookViaChat(request, visitor, start);

  const onCalDAV = await getProviderEvents(request, 'caldav', caldav.id);
  const onGoogle = await getProviderEvents(request, 'gcal', gcal.id);
  expect(onCalDAV, 'event lands on the new active (CalDAV)').toHaveLength(1);
  expect(onCalDAV[0]!.start).toBe(start);
  expect(onGoogle, 'old active (Google) stops receiving events after the switch').toHaveLength(0);
}

async function runGatingNotProviderBound(request: APIRequestContext): Promise<void> {
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  const gcal = await connectGoogleCalendar(request, csrf);
  const caldav = await connectCalDAVCalendar(request, csrf);
  await activateConnector(request, csrf, gcal.id);

  // 起点：有 active connected → 开闸。
  await expectGated(request, csrf, false);

  // 断开两个 → 无任何 connected 候选 → 复闸。
  await disconnectConnector(request, csrf, gcal.id);
  await disconnectConnector(request, csrf, caldav.id);
  await expectGated(request, csrf, true);

  // 只要重连**任一个并 active** → 解闸（gate 不挑是 Google 还是 CalDAV）。
  await reconnectConnector(request, csrf, caldav.id);
  await activateConnector(request, csrf, caldav.id);
  await expectGated(request, csrf, false);
}

async function runDisconnectActiveFallback(request: APIRequestContext): Promise<void> {
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  const gcal = await connectGoogleCalendar(request, csrf);
  const caldav = await connectCalDAVCalendar(request, csrf);
  // Google active，CalDAV 是 connected 的 inactive 候选。
  await activateConnector(request, csrf, gcal.id);

  // 断开 active（Google）。还剩 CalDAV connected。
  await disconnectConnector(request, csrf, gcal.id);

  // ── EXPECT-FALLBACK（rule#6 假设：自动 promote 剩下的 connected 候选）──
  const cals = await listConnectors(request, csrf, 'calendar');
  expect(activeId(cals), 'fallback: CalDAV auto-promotes to active').toBe(caldav.id);
  await expectGated(request, csrf, false); // 仍有 active connected → 不复闸

  // booker 落到回退后的 active（CalDAV）。
  const start = futureSlot(9, 16);
  const visitor = await codeVisitor(request, csrf, 'Fallback Fred', 'fred@example.com');
  await bookViaChat(request, visitor, start);
  const onCalDAV = await getProviderEvents(request, 'caldav', caldav.id);
  expect(onCalDAV, 'after fallback the booker lands on CalDAV').toHaveLength(1);

  // ── EXPECT-REGATE（备选语义：不回退）──若实现选这条，替换上面 FALLBACK 段为：
  //   expect(activeId(cals), 'no fallback → no active').toBeUndefined();
  //   await expectGated(request, csrf, true); // 断 active 断开 → re-gate
  //   …并删掉本 test 的 book 断言（owner 须重新 set-active）。
}

async function runDisconnectInactiveNoop(request: APIRequestContext): Promise<void> {
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  const gcal = await connectGoogleCalendar(request, csrf);
  const caldav = await connectCalDAVCalendar(request, csrf);
  await activateConnector(request, csrf, gcal.id); // Google active, CalDAV inactive

  // 断 inactive（CalDAV）。
  await disconnectConnector(request, csrf, caldav.id);

  const cals = await listConnectors(request, csrf, 'calendar');
  expect(activeId(cals), 'disconnecting inactive leaves the active slot untouched').toBe(gcal.id);
  await expectGated(request, csrf, false);

  const start = futureSlot(10, 11);
  const visitor = await codeVisitor(request, csrf, 'Stable Steve', 'steve@example.com');
  await bookViaChat(request, visitor, start);
  const onGoogle = await getProviderEvents(request, 'gcal', gcal.id);
  expect(onGoogle, 'active (Google) receives events as usual').toHaveLength(1);
}

// ─── inline helpers (promote to fixtures/connector-coexist.ts when 实现转绿) ───

interface ConnRef { id: string; category: string; kind: string; connected: boolean; active?: boolean }
interface CalEvent { event_id: string; summary: string; start: string; attendees?: string[] }
type ProviderKind = 'gcal' | 'caldav';

async function initOwner(playwright: Playwright): Promise<APIRequestContext> {
  resetInstance();
  const r = await playwright.request.newContext({ timeout: 30_000 });
  await claim(r, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await login(r, OWNER.email, OWNER.password);
  return r;
}

// connectGoogleCalendar —— 装一个 Google-style **openapi** calendar 连接器（spec+binding）
// 填 calendar 品类槽并连上（这里 mock OAuth 即连）。幂等：同 (category,kind) 已存在则复用。
async function connectGoogleCalendar(
  request: APIRequestContext, csrf: string,
): Promise<ConnRef> {
  let id = await findExisting(request, 'calendar', 'openapi');
  if (!id) {
    const res = await request.post(`${BACKEND}/api/admin/connectors`, {
      headers: { 'X-Csrftoken': csrf }, data: { spec: SAMPLE_SPEC, binding: SAMPLE_BINDING },
    });
    if (res.status() !== 201) throw new Error(`create gcal openapi: ${res.status()} ${await res.text()}`);
    id = (await res.json() as { id: string }).id;
  }
  await request.post(`${GCAL_MOCK}/__mock/gcal/reset`, { data: {} }).catch(() => undefined);
  await request.post(`${BACKEND}/api/admin/connectors/${id}/credentials`, {
    headers: { 'X-Csrftoken': csrf }, data: { client_id: 'kc-client', client_secret: 'kc-secret' },
  });
  // oauth2 dance：connect 给同意页 URL，跟一遍 authorize→callback→token，回来即 connected+active。
  const conn = await request.post(`${BACKEND}/api/admin/connectors/${id}/connect`, {
    headers: { 'X-Csrftoken': csrf }, data: {},
  });
  const { auth_url: authURL } = await conn.json() as { auth_url?: string };
  if (authURL) await request.get(authURL);
  const st = await request.get(`${BACKEND}/api/admin/connectors/${id}/status`);
  return await st.json() as ConnRef;
}

// connectCalDAVCalendar —— 装一个非-Google **protocol** calendar 连接器（CalDAV）填同一品类槽。
async function connectCalDAVCalendar(
  request: APIRequestContext, csrf: string,
): Promise<ConnRef> {
  const id = await ensureProtocolConnector(request, csrf, {
    kind: 'protocol', protocol: 'caldav', category: 'calendar',
  });
  await request.post(`${CALDAV_MOCK}/__mock/caldav/${id}/reset`, { data: {} }).catch(() => undefined);
  await request.post(`${BACKEND}/api/admin/connectors/${id}/credentials`, {
    headers: { 'X-Csrftoken': csrf },
    data: { url: `${CALDAV_API}/caldav/${id}`, username: 'owner', password: 'pw', tls: 'none' },
  });
  return connectAndRead(request, csrf, id);
}

interface ProtocolCreateBody { kind: string; protocol: string; category: string }

// ensureProtocolConnector —— 建 protocol 连接器，若同 (category,kind) 已有则复用。
async function ensureProtocolConnector(
  request: APIRequestContext, csrf: string, body: ProtocolCreateBody,
): Promise<string> {
  const hit = await findExisting(request, body.category, body.kind);
  if (hit) return hit;
  const res = await request.post(`${BACKEND}/api/admin/connectors`, {
    headers: { 'X-Csrftoken': csrf }, data: body,
  });
  if (res.status() !== 201) throw new Error(`create protocol connector: ${res.status()}`);
  return (await res.json() as { id: string }).id;
}

// findExisting —— 复用同 (category,kind) 的连接器（test 间共享同一 owner instance 时幂等）。
async function findExisting(
  request: APIRequestContext, category: string, kind: string,
): Promise<string | undefined> {
  const res = await request.get(`${BACKEND}/api/admin/connectors`);
  if (res.status() !== 200) return undefined;
  const rows = (await res.json() as { connectors?: ConnRef[] }).connectors ?? [];
  return rows.find((c) => c.category === category && c.kind === kind)?.id;
}

// listConnectors —— 列某品类下所有连接器（共存里有多个）。
async function listConnectors(
  request: APIRequestContext, _csrf: string, category: string,
): Promise<ConnRef[]> {
  const res = await request.get(`${BACKEND}/api/admin/connectors`);
  if (res.status() !== 200) throw new Error(`list connectors: ${res.status()}`);
  const rows = (await res.json() as { connectors?: ConnRef[] }).connectors ?? [];
  return rows.filter((c) => c.category === category);
}

function activeId(cals: ConnRef[]): string | undefined {
  return cals.find((c) => c.active)?.id;
}

// activateConnector —— 把某连接器设为其品类的 active（占槽）。设计未列此端，本契约提议
// POST …/{id}/activate（共存仲裁的显式选择动作，对应 rule#1/#4）。
async function activateConnector(
  request: APIRequestContext, csrf: string, id: string,
): Promise<void> {
  const res = await request.post(`${BACKEND}/api/admin/connectors/${id}/activate`, {
    headers: { 'X-Csrftoken': csrf }, data: {},
  });
  if (res.status() !== 200) throw new Error(`activate ${id}: ${res.status()}`);
}

async function connectAndRead(
  request: APIRequestContext, csrf: string, id: string,
): Promise<ConnRef> {
  const res = await request.post(`${BACKEND}/api/admin/connectors/${id}/connect`, {
    headers: { 'X-Csrftoken': csrf }, data: {},
  });
  if (res.status() !== 200) throw new Error(`connect ${id}: ${res.status()}`);
  const st = await request.get(`${BACKEND}/api/admin/connectors/${id}/status`);
  return await st.json() as ConnRef;
}

async function disconnectConnector(
  request: APIRequestContext, csrf: string, id: string,
): Promise<void> {
  const res = await request.post(`${BACKEND}/api/admin/connectors/${id}/disconnect`, {
    headers: { 'X-Csrftoken': csrf }, data: {},
  });
  if (res.status() !== 200) throw new Error(`disconnect ${id}: ${res.status()}`);
}

async function reconnectConnector(
  request: APIRequestContext, csrf: string, id: string,
): Promise<void> {
  await connectAndRead(request, csrf, id);
}

// expectGated —— 断 calendar.book 的 dep-gate 是否复闸（true=闸住/disconnected）。
async function expectGated(
  request: APIRequestContext, csrf: string, gated: boolean,
): Promise<void> {
  const cap = await findCapability(request, csrf, 'calendar.book');
  expect(cap?.dependency?.connected, gated ? 're-gated → disconnected' : 'open → connected')
    .toBe(!gated);
}

// codeVisitor —— 发一张 granted calendar.book 的码 + 颁 session（共存里多次用）。
async function codeVisitor(
  request: APIRequestContext, csrf: string, name: string, email: string,
): Promise<{ session_token: string; conversation_id: string }> {
  const code = await issueCodeWithSkills(request, csrf, { granted_skills: ['calendar.book'] });
  return await issueSession(request, {
    handle: OWNER.handle, mode: 'code', code: code.code,
    visitor_name: name, visitor_email: email,
  });
}

// bookViaChat —— 脚本化一次 calendar_book tool call + 跑访客一轮（booker 落到 active provider）。
async function bookViaChat(
  request: APIRequestContext,
  visitor: { session_token: string; conversation_id: string },
  start: string,
): Promise<void> {
  await scriptMockToolCall(request, {
    name: 'calendar_book',
    args: { topic: 'Coexist booking', duration_min: 30, preferred_times: [start] },
  });
  await sendAndDrain(
    request,
    { ...visitor, owner_handle: OWNER.handle },
    'Book a 30-min chat?',
  );
}

// gcalRawEvent —— gcal mock 的 event 形（start 是 {dateTime} 对象，attendees 是 {email} 列表）。
interface GcalRawEvent {
  event_id: string; summary: string;
  start?: { dateTime?: string }; attendees?: { email?: string }[];
}

// getProviderEvents —— 读某 provider mock 记录的 event，归一成 CalEvent（断 booker 落到哪个 kind）。
// gcal mock 全局（/__mock/gcal/events，start={dateTime}）；caldav 按 collection（start 已是字符串）。
async function getProviderEvents(
  request: APIRequestContext, provider: ProviderKind, connID: string,
): Promise<CalEvent[]> {
  if (provider === 'gcal') {
    const res = await request.get(`${GCAL_MOCK}/__mock/gcal/events`);
    if (res.status() !== 200) throw new Error(`gcal events: ${res.status()}`);
    const raw = (await res.json() as { events?: GcalRawEvent[] }).events ?? [];
    return raw.map((e) => ({
      event_id: e.event_id, summary: e.summary, start: e.start?.dateTime ?? '',
      attendees: (e.attendees ?? []).map((a) => a.email ?? ''),
    }));
  }
  const res = await request.get(`${CALDAV_MOCK}/__mock/caldav/${connID}/events`);
  if (res.status() !== 200) throw new Error(`caldav events: ${res.status()}`);
  return (await res.json() as { events: CalEvent[] }).events;
}
