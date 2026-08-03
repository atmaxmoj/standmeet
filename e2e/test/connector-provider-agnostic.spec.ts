// connector-provider-agnostic.spec.ts —— #155 §8 区 F（消费闭环），重点 provider-agnostic。
//
// ⭐ 命门（品类归一）：装一个**非 Google** 的 calendar 连接器（CalDAV，kind=protocol；
// 或一个 test provider）填「calendar」品类槽 → 一个 calendar.book-granted 的 session
// 照样装配出 calendar_book，且 booking 真能跑通——**booker 代码一行不改**。这证明
// consumer（booker）只认 CalendarContract，背后是 Google / CalDAV / SMTP 一概不知
// （docs/design/connector.md §2「契约把 kind 抽象掉」+ §5.3 消费流）。
//
// 还覆盖：
//   - SMTP（kind=protocol）填 mail 品类 → mailer 经 MailContract.Send 发信，无视 kind。
//   - err：连接器 connected 但 runtime API 5xx → 友好降级（不崩、不泄 stack、不建 event）。
//   - dep-gating：calendar 连接器 connect/disconnect → calendar.book cap un-gate / re-gate
//     （经 DepRegistry 的全局单点闸，connector.md §6 + capabilities.ts dependency.connected）。
//
// 覆盖「品类归一让任意 provider 喂 booker」。已实现，真编译、真跑、真绿（booker 经品类
// 契约接任意 provider，不再只认手搓 gcal-specific connector；原为 RED 契约，实现后转绿）。
//
// §8 接口草图对齐：CalendarContract.{ListBusy,CreateEvent} / MailContract.Send；
//   capabilities.ts dependency.connected；gcal-setup 的 connected-owner 复用为对照组。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { findCapability } from '@/fixtures/capabilities';
import { issueCodeWithSkills, expectCalendarBookExposed } from '@/fixtures/agent-skills-grant';
import { issueSession } from '@/fixtures/visitor';
import { scriptMockToolCall, sendAndDrain } from '@/fixtures/mock-llm-script';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
// 非 Google calendar provider 的 mock 控制面（CalDAV/test provider）：set_busy /
// events / fail / reset，跟 gcal mock 同构但走「calendar」品类的 provider-agnostic 端。
const CALDAV_MOCK = process.env['CALDAV_MOCK_URL'] ?? 'http://localhost:9000';
// backend 容器内打 CalDAV 用 service-name（SSRF 白名单放行）；控制面读用 localhost。
const CALDAV_API = 'http://external-mock:9000';

const OWNER = {
  email: 'provider-agnostic@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'paowner',
  fullName: 'Provider Agnostic Owner',
};

function futureSlot(daysAhead: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  // 默认 booking policy 只允许 Mon-Fri；跳到下一个工作日，slot 才过策略闸。
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

test.describe('connector · provider-agnostic consumer loop (area F)', () => {
  // #155 §8-F：品类归一 —— 非 Google（CalDAV protocol）calendar 喂 booker，代码一行不改。
  // SMTP mail 那条经「mail 作为访客 capability」（sandboxed mail-sender 插件）发信,已实现。

  let request: APIRequestContext;
  test.beforeAll(async ({ playwright }) => {
    request = await initOwner(playwright);
  });
  test.afterAll(async () => { await request.dispose(); });

  // ⭐ 核心：非 Google calendar → booker book 成功，booker 代码路径不变。
  test('non-Google (CalDAV) calendar connects → calendar_book assembles + booking works (booker unchanged)',
    async () => {
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      // 装一个非 gcal 的 calendar 连接器填「calendar」品类槽，并连上（无 OAuth dance）。
      const conn = await connectCalDAVCalendar(request, csrf);

      // dep-gating：calendar 品类槽现在「connected」→ calendar.book cap 解闸。
      const cap = await findCapability(request, csrf, 'calendar.book');
      expect(cap?.dependency?.connected, 'CalDAV connected → calendar category slot connected').toBe(true);

      // 发码（granted calendar.book）+ session。
      const code = await issueCodeWithSkills(request, csrf, { granted_skills: ['calendar.book'] });
      const visitor = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code: code.code,
        visitor_name: 'Recruiter Rachel', visitor_email: 'rachel@example.com',
      });

      // 装配出 calendar_book（品类归一：consumer 不知背后是 CalDAV）。
      await expectCalendarBookExposed(request, visitor.session_token, true);

      // 真 book：booker 走 CalendarContract.{ListBusy,CreateEvent}，落到 CalDAV provider。
      const start = futureSlot(7, 14);
      const tag = await scriptMockToolCall(request, {
        name: 'calendar_book',
        args: { topic: 'Provider-agnostic booking', duration_min: 30, preferred_times: [start] },
      });
      await sendAndDrain(request, visitor, `Book a 30-min chat next week?${tag}`);

      // ⭐ event 落在**非 Google** provider 上 —— 同一份 booker 代码、不同 provider。
      const events = await getCalDAVEvents(request, conn.id);
      expect(events, 'CalDAV provider received the booker-created event').toHaveLength(1);
      expect(events[0]!.summary).toContain('Recruiter Rachel');
      expect(events[0]!.start).toBe(start);
      expect(events[0]!.attendees ?? [], 'attendee comes from the session profile').toContain('rachel@example.com');
    });

  // SMTP（kind=protocol）→ mailer 经 MailContract.Send 发信，无视 kind。经「mail 作为访客
  // capability」（mail.send，sandboxed 插件）发出,已实现,绿。
  test('SMTP connector (kind=protocol) → mailer sends via MailContract.Send (kind-agnostic)',
    async () => {
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      await connectSMTPMail(request, csrf);

      const cap = await findCapability(request, csrf, 'mail.send');
      expect(cap?.dependency?.connected, 'SMTP connected → mail category slot connected').toBe(true);

      // mailer 经品类契约发一封（这里走 connector 自测发信端，断 sent + provider=protocol）。
      const sent = await sendViaMailContract(request, csrf, {
        to: 'recruiter@corp.test', subject: 'PA mail', text: 'hello from SMTP',
      });
      expect(sent.ok, 'MailContract.Send succeeds via SMTP').toBe(true);
      expect(sent.via_kind, 'mailer neither knows nor cares it is protocol underneath').toMatch(/protocol|smtp/i);
    });

  // err：连接器 connected 但 runtime API 5xx → 友好降级，不崩、不泄 stack、不建 event。
  test('CalDAV connected but runtime 5xx → friendly degrade (no 5xx, no stack, no event)',
    async () => {
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      const conn = await connectCalDAVCalendar(request, csrf);
      // 让下一次 create-event runtime 调用返 500（connected 但 API 挂）。
      await failNextCalDAV(request, conn.id, 'create_event', 500);

      const code = await issueCodeWithSkills(request, csrf, { granted_skills: ['calendar.book'] });
      const visitor = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'V',
      });
      const { status, body } = await callBook(request, visitor);

      expect(status, 'a runtime 5xx must not crash us').toBeLessThan(500);
      const msg = `${body.reason ?? ''} ${body.result?.error ?? ''}`;
      expect(msg, 'friendly try-again').toMatch(/again|later|unavailable|calendar|couldn'?t/i);
      expect(msg, 'does not leak the provider raw error/stack').not.toMatch(/panic|goroutine|stack|5\d\d/i);
      expect(await getCalDAVEvents(request, conn.id), 'degraded → no event created').toHaveLength(0);
    });

  // dep-gating：calendar 连接器 disconnect → cap re-gate；reconnect → un-gate。
  test('calendar connector disconnect → calendar.book re-gated; reconnect → un-gated',
    async () => { await runDepGating(request); });
});

// ─── helpers (inline; promote to fixtures/connector-providers.ts when实现转绿) ───

interface ConnRef { id: string; category: string; kind: string; connected: boolean }
interface CalEvent { event_id: string; summary: string; start: string; attendees?: string[] }
interface BookToolResp { reason?: string; result?: { error?: string } }
interface MailSendResp { ok: boolean; via_kind?: string }

async function initOwner(playwright: Playwright): Promise<APIRequestContext> {
  resetInstance();
  const request = await playwright.request.newContext({ timeout: 30_000 });
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await login(request, OWNER.email, OWNER.password);
  return request;
}

// runDepGating —— calendar 连接器 connect → un-gate，disconnect → re-gate，reconnect → un-gate。
// 经 DepRegistry 全局单点闸（capabilities.ts dependency.connected 驱动）。
async function runDepGating(request: APIRequestContext): Promise<void> {
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  const conn = await connectCalDAVCalendar(request, csrf);
  const code = await issueCodeWithSkills(request, csrf, { granted_skills: ['calendar.book'] });
  const newSession = (name: string) =>
    issueSession(request, { handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: name });

  // 连上：暴露。
  await expectCalendarBookExposed(request, (await newSession('A')).session_token, true);

  // 断开 → 全局单点闸据 dependency.connected=false 把 calendar.book gate 掉。
  await disconnectConnector(request, csrf, conn.id);
  const capGated = await findCapability(request, csrf, 'calendar.book');
  expect(capGated?.dependency?.connected, 'disconnected → category slot disconnected').toBe(false);
  await expectCalendarBookExposed(request, (await newSession('B')).session_token, false);

  // 重连 → 复闸（un-gate）。
  await reconnectConnector(request, csrf, conn.id);
  await expectCalendarBookExposed(request, (await newSession('C')).session_token, true);
}

// connectCalDAVCalendar —— 装一个**非 Google** calendar 连接器（CalDAV，kind=protocol）
// 填 calendar 品类槽并连上（存凭据即连，无 OAuth dance）。返回 connector 引用。
// 幂等：已存在则复用 — 多个 test 共享同一 owner instance。
async function connectCalDAVCalendar(
  request: APIRequestContext, csrf: string,
): Promise<ConnRef> {
  const id = await ensureConnector(request, csrf, {
    kind: 'protocol', protocol: 'caldav', category: 'calendar',
  });
  // 清这个 collection 的 mock 状态（events/busy/fail）—— 多 test 共享同一连接器，绝对计数要干净。
  await request.post(`${CALDAV_MOCK}/__mock/caldav/${id}/reset`, { data: {} }).catch(() => undefined);
  await request.post(`${BACKEND}/api/admin/connectors/${id}/credentials`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      url: `${CALDAV_API}/caldav/${id}`, username: 'owner', password: 'pw', tls: 'none',
    },
  });
  return connectAndRead(request, csrf, id);
}

// connectSMTPMail —— 装 SMTP(protocol) 填 mail 品类槽并连上。
async function connectSMTPMail(request: APIRequestContext, csrf: string): Promise<ConnRef> {
  const id = await ensureConnector(request, csrf, {
    kind: 'protocol', protocol: 'smtp', category: 'mail',
  });
  const host = process.env['MAILPIT_SMTP_HOST'] ?? 'mail-mock';
  await request.post(`${BACKEND}/api/admin/connectors/${id}/credentials`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      host, port: '1025', username: '', password: '',
      from_address: 'noreply@standmeet.test', from_name: 'StandMeet',
    },
  });
  return connectAndRead(request, csrf, id);
}

interface CreateConnectorBody { kind: string; protocol: string; category: string }

// ensureConnector —— 建 connector，若同 category 已有则复用（test 间幂等）。
async function ensureConnector(
  request: APIRequestContext, csrf: string, body: CreateConnectorBody,
): Promise<string> {
  const existing = await request.get(`${BACKEND}/api/admin/connectors`);
  if (existing.status() === 200) {
    const rows = (await existing.json() as { connectors?: ConnRef[] }).connectors ?? [];
    const hit = rows.find((c) => c.category === body.category);
    if (hit) return hit.id;
  }
  const res = await request.post(`${BACKEND}/api/admin/connectors`, {
    headers: { 'X-Csrftoken': csrf }, data: body,
  });
  if (res.status() !== 201) throw new Error(`create connector ${body.category}: ${res.status()}`);
  return (await res.json() as { id: string }).id;
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

// sendViaMailContract —— 经 connector 自测发信端触发 MailContract.Send（验 mailer
// 走品类契约、不关心底下 kind）。返回 {ok, via_kind}。
async function sendViaMailContract(
  request: APIRequestContext, csrf: string,
  mail: { to: string; subject: string; text: string },
): Promise<MailSendResp> {
  // 地址是**从声明派生**的:`/connectors/ops/<opID 去掉 connectors. 前缀>`。
  // 以前这里写死 `/connectors/mail/test-send` —— 那条路由长在通用的连接器注册表上,
  // 于是通用那一层里出现了一个品类的名字。现在注册表一个品类名都不写,名字来自
  // backend/connectors/smtp/manifest.yaml 的 owner_ops。
  const res = await request.post(`${BACKEND}/api/admin/connectors/ops/mail_test_send`, {
    headers: { 'X-Csrftoken': csrf }, data: mail,
  });
  if (res.status() !== 200) throw new Error(`mail test-send: ${res.status()}`);
  return await res.json() as MailSendResp;
}

// getCalDAVEvents —— 读非 Google provider mock 记录的 event（断 booker 真落到它）。
async function getCalDAVEvents(
  request: APIRequestContext, connID: string,
): Promise<CalEvent[]> {
  const res = await request.get(`${CALDAV_MOCK}/__mock/caldav/${connID}/events`);
  if (res.status() !== 200) throw new Error(`caldav events: ${res.status()}`);
  return (await res.json() as { events: CalEvent[] }).events;
}

// failNextCalDAV —— provider mock：让下一次某 op 返指定 status（runtime 5xx 降级）。
async function failNextCalDAV(
  request: APIRequestContext, connID: string, op: string, status: number,
): Promise<void> {
  await request.post(`${CALDAV_MOCK}/__mock/caldav/${connID}/fail`, { data: { op, status } });
}

// callBook —— 直接打 booker 的 tool 端（避开 LLM 脚本，干净断降级形状）。
async function callBook(
  request: APIRequestContext, visitor: { conversation_id: string; session_token: string },
): Promise<{ status: number; body: BookToolResp }> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${visitor.conversation_id}/tools/calendar_book`,
    {
      headers: { Authorization: `Bearer ${visitor.session_token}` },
      data: { topic: 'PA 5xx', duration_min: 30, preferred_times: [futureSlot(7, 14)] },
    },
  );
  return { status: res.status(), body: await res.json() as BookToolResp };
}
