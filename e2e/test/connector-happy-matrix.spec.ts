// connector-happy-matrix.spec.ts —— #155 §8 的「全闭环组合矩阵」红契约（RED）。
//
// 这是 connector 装配的 **end-to-end happy 组合** 网：kind × category × auth 的
// 每个对角线格子，从 admin UI **装配** → **connect** → **consumer 真跑通** 一条龙。
// 每条 test = 一个完整组合，只断**那一个** consumer 结局；分支/错误/边界归各区 spec
// （assemble-from-ui / binding-jsonata / provider-agnostic）所有，这里不重复。
//
// 覆盖的 5 个对角线组合（docs/design/connector.md §1 矩阵 + §4 auth + §5.2 装配流）：
//   1. openapi · calendar · oauth2  (Google 式)  → 传 spec → 派生 oauth2 表单 → dance
//      → calendar.book 装配 → booker 真 book → event 落 provider。
//   2. openapi · calendar · apiKey  (非 oauth 日历 API) → 传 spec → apiKey 表单 → 无 dance
//      → calendar.book 真跑。
//   3. protocol · calendar · CalDAV → 选内置卡 → 固定表单 → connect → calendar.book 真跑。
//   4. openapi · mail · bearer → 传 spec → bearer 表单 → connect → mail.send (MailContract) 真发。
//   5. protocol · mail · SMTP → 选内置卡 → 固定表单 → connect → mail.send 真发。
//
// 全部 test.fixme：spec-driven 装配 UI + 派生表单 + 各 auth connect 流 + 品类归一消费
// 都未建（§8 第一期主干 A+B+D+F）。实现逐格转绿后删 fixme。
//
// 接口（§8 目标接口，真 testid）：admin-nav-connectors / connector-add-open /
// connector-card-{category} / connector-spec-input / connector-spec-submit /
// connector-scheme-select / connector-field-{key} / connector-connect-button /
// connector-status；REST GET /api/admin/connectors（拿 {id}）；diag/consumer 走 API。
//
// 约定：UI 跑装配（adminPage，无 page.goto，从 admin-nav-connectors 点进去），API 断
// consumer 结局。helpers 内联（gold pattern 的薄版），fixtures/ 不动。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@/fixtures/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { findCapability } from '@/fixtures/capabilities';
import { issueCodeWithSkills, expectCalendarBookExposed } from '@/fixtures/agent-skills-grant';
import { issueSession } from '@/fixtures/visitor';
import { scriptMockToolCall, sendAndDrain } from '@/fixtures/mock-llm-script';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
// Mock 控制面：gcal (oauth2 calendar) / caldav (protocol calendar) / smtp+mailpit (mail)
// 都挂 job-board-mock 同源；apiKey/bearer 的 calendar/mail API 复用 gcal mock 端点
// （servers 指过去，仅 securityScheme 不同 → 同一个运行时打同一个录制器）。
// MOCK —— 测试脚本(node) + 浏览器用的地址（宿主机 → localhost）；MOCK_API —— spec 里写给后端容器
// 用的地址（docker 网络名 job-board-mock，在 SSRF 白名单内）。两者指向同一个 mock（9000 宿主映射），
// 所以后端写的事件/信，node 控制端点照样读得到。一个名字三方解析不同，所以拆开。
const MOCK = process.env['MOCK_BASE_URL'] ?? 'http://localhost:9000';
const MOCK_API = process.env['MOCK_API_URL'] ?? 'http://job-board-mock:9000';
const MAILPIT = process.env['MAILPIT_URL'] ?? 'http://localhost:18025';
const SMTP_HOST = process.env['MAILPIT_SMTP_HOST'] ?? 'mail-mock';

const OWNER = {
  email: 'happy-matrix@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'hmowner',
  fullName: 'Happy Matrix Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

// ─── inlined sample OpenAPI 3.0 specs + bindings (one per openapi combo) ───
// 共用一份最小 calendar/mail paths；只换 securitySchemes（auth 轴）。servers 指 mock。

const CAL_PATHS = {
  '/freeBusy': { post: { operationId: 'freebusy.query', responses: { '200': { description: 'ok' } } } },
  '/events': { post: { operationId: 'events.insert', responses: { '200': { description: 'ok' } } } },
} as const;

// combo 1: openapi calendar + oauth2 (Google 式：填完字段有 Connect dance)。
const OAUTH2_CAL_SPEC = {
  openapi: '3.0.3',
  info: { title: 'OAuth Calendar', version: '1.0.0' },
  servers: [{ url: `${MOCK_API}/__mock/gcal` }],
  paths: CAL_PATHS,
  components: {
    securitySchemes: {
      oauth2: {
        type: 'oauth2',
        flows: {
          authorizationCode: {
            authorizationUrl: `${MOCK}/__mock/gcal/authorize`,
            tokenUrl: `${MOCK_API}/__mock/gcal/token`,
            scopes: { 'calendar.readonly': 'read', 'calendar.events': 'write' },
          },
        },
      },
    },
  },
} as const;

// combo 2: openapi calendar + apiKey (非 oauth 日历 API：填一个 key，无 dance)。
const APIKEY_CAL_SPEC = {
  openapi: '3.0.3',
  info: { title: 'ApiKey Calendar', version: '1.0.0' },
  servers: [{ url: `${MOCK_API}/__mock/gcal` }],
  paths: CAL_PATHS,
  components: {
    securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'X-Api-Key' } },
  },
} as const;

// combo 4: openapi mail + bearer (token in Authorization: Bearer，无 dance)。
const BEARER_MAIL_SPEC = {
  openapi: '3.0.3',
  info: { title: 'Bearer Mail', version: '1.0.0' },
  servers: [{ url: `${MOCK_API}/__mock/mailapi` }],
  paths: { '/send': { post: { operationId: 'messages.send', responses: { '202': { description: 'ok' } } } } },
  components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
} as const;

// 绑定（声明式 JSONata，作者搓）。calendar 两 op、mail 一 op。
const CAL_BINDING = {
  category: 'calendar', kind: 'openapi',
  operations: {
    list_busy: {
      op: 'freebusy.query',
      request: '{ "timeMin": timeMin, "timeMax": timeMax, "items": [{ "id": "primary" }] }',
      response: 'calendars.primary.busy.{ "start": start, "end": end }',
    },
    create_event: {
      // 契约变量名跟 CalendarProxy.CreateEvent 一致（summary / start / end / visitorEmail）。
      op: 'events.insert',
      request: '{ "summary": summary, "start": { "dateTime": start }, "end": { "dateTime": end }, '
        + '"attendees": [{ "email": visitorEmail }] }',
      response: '{ "id": id, "url": htmlLink }',
    },
  },
} as const;

const MAIL_BINDING = {
  category: 'mail', kind: 'openapi',
  operations: {
    send: {
      op: 'messages.send',
      request: '{ "to": to, "subject": subject, "text": text }',
      response: '{ "id": id }',
    },
  },
} as const;

const CAL_TOOLS = ['calendar.book'] as const;

// ─── helpers (inline thin; promote to fixtures/ when実现转绿) ─────────────────
interface ConnRef { id: string; category: string; kind: string; connected: boolean }
interface CalEvent { summary: string; start: string; attendees?: string[] }
interface MailMsg { to: string[]; subject: string }

// ─── UI assemble drivers (no page.goto; click admin-nav-connectors → add) ───

// openByCategory —— 进 connectors 区，点「加」，按品类挑卡（openapi: spec-driven
// 候选卡；protocol: 内置协议卡）。返回那张卡的 locator 供后续填表/connect。
async function openAddCard(page: Page, category: string) {
  await page.getByTestId('admin-nav-connectors').click();
  await page.getByTestId('connector-add-open').click();
  await page.getByTestId(`connector-card-${category}`).click();
}

// assembleOpenAPI —— 传 spec+binding（connector-spec-input/submit）→（多 scheme）选
// scheme → 填派生字段 → connect。返回该连接器（GET /api/admin/connectors 取最新 {id}）。
async function assembleOpenAPI(
  page: Page, request: APIRequestContext, opts: {
    category: string; spec: unknown; binding: unknown;
    scheme?: string; fields: Record<string, string>; needsDance: boolean;
  },
): Promise<ConnRef> {
  const before = await connectorIdSet(request);
  await openAddCard(page, opts.category);
  await page.getByTestId('connector-spec-input')
    .fill(JSON.stringify({ spec: opts.spec, binding: opts.binding }));
  await page.getByTestId('connector-spec-submit').click();
  if (opts.scheme) await page.getByTestId('connector-scheme-select').selectOption(opts.scheme);
  for (const [k, v] of Object.entries(opts.fields)) {
    await page.getByTestId(`connector-field-${k}`).fill(v);
  }
  await page.getByTestId('connector-connect-button').click();
  // dance：整页跳去 provider 同意页再回来（waitForURL 可能因「本就在 /admin/connectors」提前命中，
  // 由 newConnector 的轮询兜住 callback 落库的延迟）。非 dance：原地连，状态直接翻 connected。
  if (opts.needsDance) await page.waitForURL('**/admin/connectors**');
  else await expect(page.getByTestId('connector-status')).toHaveText(/connected|已连接/i);
  return newConnector(request, before, opts.category);
}

// assembleProtocol —— 选内置协议卡（固定表单，无 spec）→ 填固定字段 → connect。
async function assembleProtocol(
  page: Page, request: APIRequestContext, opts: {
    category: string; fields: Record<string, string>;
  },
): Promise<ConnRef> {
  const before = await connectorIdSet(request);
  await openAddCard(page, opts.category);
  for (const [k, v] of Object.entries(opts.fields)) {
    await page.getByTestId(`connector-field-${k}`).fill(v);
  }
  await page.getByTestId('connector-connect-button').click();
  await expect(page.getByTestId('connector-status')).toHaveText(/connected|已连接/i);
  return newConnector(request, before, opts.category);
}

// connectorIdSet —— 装配前拍一张「现有连接器 id」快照，装配后 diff 出新建那个。
async function connectorIdSet(request: APIRequestContext): Promise<Set<string>> {
  const res = await request.get(`${BACKEND}/api/admin/connectors`);
  if (res.status() !== 200) throw new Error(`list connectors: ${res.status()}`);
  const rows = (await res.json() as { connectors?: ConnRef[] }).connectors ?? [];
  return new Set(rows.map((c) => c.id));
}

// newConnector —— 轮询直到出现一个 before 快照里没有、且 connected 的该品类连接器（= 刚装的那个）。
// 多 combo 共享 owner：按品类取「第一个 connected」会拿到旧 combo 的连接器（于是 activate 错连接器、
// booker 走错 provider）；按「新出现的 id」精确定位才对。
async function newConnector(
  request: APIRequestContext, before: Set<string>, category: string,
): Promise<ConnRef> {
  let hit: ConnRef | undefined;
  await expect.poll(async () => {
    const res = await request.get(`${BACKEND}/api/admin/connectors`);
    if (res.status() !== 200) return false;
    const rows = (await res.json() as { connectors?: ConnRef[] }).connectors ?? [];
    hit = rows.find((c) => c.category === category && c.connected && !before.has(c.id));
    return Boolean(hit);
  }, { timeout: 15_000 }).toBe(true);
  if (!hit) throw new Error(`no new connected ${category} connector found`);
  return hit;
}

function futureSlot(daysAhead: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

// ─── consumer assertions (the ONE outcome per combo) ──────────────────────

// bookOnce —— 发 calendar.book 码 + session → 装配 calendar_book → 真 book 一次。
async function bookOnce(
  request: APIRequestContext, csrf: string, start: string,
): Promise<void> {
  const code = await issueCodeWithSkills(request, csrf, { granted_skills: [...CAL_TOOLS] });
  const visitor = await issueSession(request, {
    handle: OWNER.handle, mode: 'code', code: code.code,
    visitor_name: 'Recruiter Rachel', visitor_email: 'rachel@example.com',
  });
  await expectCalendarBookExposed(request, visitor.session_token, true);
  await scriptMockToolCall(request, {
    name: 'calendar_book',
    args: { topic: 'Happy matrix booking', duration_min: 30, preferred_times: [start] },
  });
  await sendAndDrain(request, visitor, 'Book a 30-min chat next week?');
}

// bookAndAssert —— calendar combo 的共用尾巴：断品类槽 connected → 真 book 一次 →
// 断 event 落到 provider（attendee 来自 session profile）。各 calendar test 只换装配。
async function bookAndAssert(
  request: APIRequestContext, csrf: string, daysAhead: number,
  readEvents: (r: APIRequestContext) => Promise<CalEvent[]> = getEvents,
): Promise<void> {
  const cap = await findCapability(request, csrf, 'calendar.book');
  expect(cap?.dependency?.connected, 'calendar 品类槽 connected').toBe(true);
  const start = futureSlot(daysAhead, 14);
  await bookOnce(request, csrf, start);
  const events = await readEvents(request);
  expect(events, 'provider 收到 booker 创建的 event').toHaveLength(1);
  expect(events[0]!.start).toBe(start);
  expect(events[0]!.attendees ?? []).toContain('rachel@example.com');
}

// activateConnector —— 把一个连接器设为它品类槽的 active（一个品类一个 active；连上不自动抢占）。
async function activateConnector(request: APIRequestContext, csrf: string, id: string): Promise<void> {
  const res = await request.post(`${BACKEND}/api/admin/connectors/${id}/activate`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (res.status() !== 200) throw new Error(`activate ${id}: ${res.status()}`);
  // 等激活在 GET /connectors 里坐实再返回 —— booker 按 active 槽解析，杜绝「刚 activate 就 book」竞态。
  await expect.poll(async () => {
    const list = await request.get(`${BACKEND}/api/admin/connectors`);
    if (list.status() !== 200) return false;
    const rows = (await list.json() as { connectors?: { id: string; active?: boolean }[] }).connectors ?? [];
    return rows.find((c) => c.id === id)?.active === true;
  }, { timeout: 10_000 }).toBe(true);
}

const CALDAV_COLL = 'hmcal';

// getCalDAVEvents —— CalDAV combo 的会落在 CalDAV mock 的 collection 里（不是 gcal store），单独读它。
async function getCalDAVEvents(request: APIRequestContext): Promise<CalEvent[]> {
  const res = await request.get(`${MOCK}/__mock/caldav/${CALDAV_COLL}/events`);
  if (res.status() !== 200) throw new Error(`caldav events: ${res.status()}`);
  return (await res.json() as { events: CalEvent[] }).events;
}

async function resetCalDAV(request: APIRequestContext): Promise<void> {
  await request.post(`${MOCK}/__mock/caldav/${CALDAV_COLL}/reset`, { data: {} }).catch(() => undefined);
}

// getEvents —— 读 calendar provider mock 记录的 event（gcal mock 收所有 calendar combo）。
interface RawEvent { summary: string; start: { dateTime: string }; attendees?: { email: string }[] }

async function getEvents(request: APIRequestContext): Promise<CalEvent[]> {
  const res = await request.get(`${MOCK}/__mock/gcal/events`);
  if (res.status() !== 200) throw new Error(`mock events: ${res.status()}`);
  // mock 存的是 gcal 形（start.dateTime / attendees[].email）；摊平成断言用的扁平形。
  const raw = (await res.json() as { events: RawEvent[] }).events;
  return raw.map((e) => ({
    summary: e.summary,
    start: e.start.dateTime,
    attendees: (e.attendees ?? []).map((a) => a.email),
  }));
}

async function resetCalMock(request: APIRequestContext): Promise<void> {
  await request.post(`${MOCK}/__mock/gcal/reset`, { data: {} });
}

// mailViaContract —— 经 mail 品类槽 test-send 触发 MailContract.Send，断 Mailpit 收到。
async function expectMailSent(
  request: APIRequestContext, csrf: string, to: string, subject: string,
): Promise<void> {
  const cap = await findCapability(request, csrf, 'mail.send');
  expect(cap?.dependency?.connected, 'mail 品类槽 connected').toBe(true);
  const res = await request.post(`${BACKEND}/api/admin/connectors/mail/test-send`, {
    headers: { 'X-Csrftoken': csrf }, data: { to, subject, text: 'hello from matrix' },
  });
  expect(res.status(), 'MailContract.Send 200').toBe(200);
  const msg = await waitForMail(request, to);
  expect(msg?.subject, 'Mailpit 收到经 MailContract 发的信').toBe(subject);
}

// waitForMail —— poll Mailpit（expect.poll 退避，不用 setTimeout-as-sleep）until 收到。
async function waitForMail(
  request: APIRequestContext, to: string,
): Promise<MailMsg | undefined> {
  let found: MailMsg | undefined;
  await expect.poll(async () => {
    const res = await request.get(`${MAILPIT}/api/v1/messages`);
    if (res.status() !== 200) return false;
    const rows = (await res.json() as { messages?: { To: { Address: string }[]; Subject: string }[] })
      .messages ?? [];
    const hit = rows.find((m) => m.To.some((t) => t.Address === to));
    if (hit) found = { to: hit.To.map((t) => t.Address), subject: hit.Subject };
    return Boolean(hit);
  }, { timeout: 10_000 }).toBe(true);
  return found;
}

test.describe('connector · happy 组合矩阵（kind × category × auth 全闭环）', () => {
  // RED 契约：spec-driven 装配 UI + 派生表单 + 各 auth connect + 品类归一消费均未建
  // （docs/design/connector.md §8 第一期 A+B+D+F）。实现逐格转绿后删 fixme。

  let request: APIRequestContext;
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    request = await playwright.request.newContext({ timeout: 30_000 });
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await login(request, OWNER.email, OWNER.password);
    await resetCalMock(request);
  });
  test.afterAll(async () => { await request.dispose(); });

  // combo 1 —— openapi · calendar · oauth2 (Google 式)：spec → 派生 oauth2 表单 →
  // dance → calendar_book 装配 → booker 真 book → event 落 provider。
  test('openapi calendar + oauth2: assemble → dance → booker books → event on provider',
    async ({ adminPage: page }) => {
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      await assembleOpenAPI(page, request, {
        category: 'calendar', spec: OAUTH2_CAL_SPEC, binding: CAL_BINDING,
        scheme: 'oauth2',
        fields: { client_id: 'mock-gcal-client-id', client_secret: 'mock-gcal-client-secret' },
        needsDance: true,
      });
      await bookAndAssert(request, csrf, 7);
    });

  // combo 2 —— openapi · calendar · apiKey (非 oauth 日历 API)：spec → apiKey 表单 →
  // 无 dance connect → calendar_book 真跑。
  test('openapi calendar + apiKey: assemble → apiKey form (no dance) → booker books',
    async ({ adminPage: page }) => {
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      await resetCalMock(request);
      await assembleOpenAPI(page, request, {
        category: 'calendar', spec: APIKEY_CAL_SPEC, binding: CAL_BINDING,
        scheme: 'apiKey', fields: { key: 'mock-calendar-api-key' }, needsDance: false,
      });
      await bookAndAssert(request, csrf, 8);
    });

  // combo 3 —— protocol · calendar · CalDAV：内置卡 → 固定表单 → connect → 显式激活 → book。
  // 前面 combo 已占了 calendar 槽（连上不自动抢占），故装配后显式 activate 这个 caldav 并坐实，
  // booker 才走它（落 CalDAV mock 的 coll，不是 gcal store）。
  test('protocol calendar (CalDAV): pick built-in card → fixed form → booker books',
    async ({ adminPage: page }) => {
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      await resetCalDAV(request);
      // CalDAV url 指 collection（后端容器经 MOCK_API 打，SSRF 白名单内）；会落 CalDAV mock 的 coll。
      const conn = await assembleProtocol(page, request, {
        category: 'calendar',
        fields: {
          url: `${MOCK_API}/caldav/${CALDAV_COLL}`, username: 'owner', password: 'pw', tls: 'none',
        },
      });
      // 品类槽「一个 active」：前面 combo 已占了 calendar 槽，连上不自动抢占 → 显式激活这个 CalDAV
      // 连接器，让 booker 走它（否则 booker 用旧的 gcal 连接器，会落 gcal store 不是 CalDAV coll）。
      await activateConnector(request, csrf, conn.id);
      await bookAndAssert(request, csrf, 9, getCalDAVEvents);
    });

  // combo 4 —— openapi · mail · bearer：spec → bearer 表单 → connect → mail.send 真发。
  test('openapi mail + bearer: assemble → bearer form → MailContract.Send delivers',
    async ({ adminPage: page }) => {
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      await assembleOpenAPI(page, request, {
        category: 'mail', spec: BEARER_MAIL_SPEC, binding: MAIL_BINDING,
        scheme: 'bearer', fields: { token: 'mock-mail-bearer-token' }, needsDance: false,
      });
      await expectMailSent(request, csrf, 'recruiter@corp.test', 'Matrix bearer mail');
    });

  // combo 5 —— protocol · mail · SMTP：内置卡 → 固定表单 → connect → mail.send 真发。
  test('protocol mail (SMTP): pick built-in card → fixed form → MailContract.Send delivers',
    async ({ adminPage: page }) => {
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      await assembleProtocol(page, request, {
        category: 'mail',
        fields: {
          host: SMTP_HOST, port: '1025', username: '', password: '',
          from: 'noreply@standmeet.test', tls: 'none',
        },
      });
      await expectMailSent(request, csrf, 'recruiter@corp.test', 'Matrix SMTP mail');
    });
});
