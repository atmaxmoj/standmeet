// connector-openapi-mail.spec.ts —— #155 §8 区 F（消费闭环），填**缺失的对角**：
// openapi × mail。
//
// 现有套件覆盖了两个对角：
//   - openapi × calendar  → connector-binding-jsonata.spec.ts（SaaS spec + JSONata 绑定）
//   - protocol × mail      → connector-protocol-smtp.spec.ts / connector-provider-agnostic.spec.ts（内置 SMTP）
// 但**没有** openapi × mail —— 即一家 SaaS 发信 HTTP API（SendGrid/Mailgun/Postmark
// 式）+ 一份把 MailContract.Send 映到「POST /mail/send」的 JSONata 绑定，填「mail」品类
// 槽。本文件就钉这条对角。
//
// 业务故事：owner 贴一份 SendGrid-style 的 OpenAPI 3.0 spec + 绑定（category=mail，
// 把 send 契约 op 映到 operationId=mail.send，auth=apiKey 或 bearer）→ 后端装配出一个
// kind=openapi 的 mail 连接器 → connect（apiKey，无 OAuth dance，存密钥即连）→ mail.send
// cap 的 dependency.connected 翻 true → mailer 经 MailContract.Send 发信，**不知/不关心**
// 底下是 HTTP SaaS 还是 SMTP → SaaS mock 收到信，且 request JSONata 把契约 {to,subject,
// text} 正确构造成了该 SaaS 的 send body 形状。
//
// 对齐 docs/design/connector.md：§1（mail = SendGrid(openapi) 或 SMTP(protocol)，契约把
// kind 抽象掉）+ §2（一个品类被两种 kind 满足；绑定声明式 op→契约映射）+ §7 决策#1
// （映射语言只 JSONata）+ §8 目标接口（REST POST /api/admin/connectors {spec,binding}；
// .../{id}/{credentials,connect,status,disconnect}；MailContract.Send；diag 直验）。
//
// 覆盖 openapi-mail 装配 + JSONata request 构造 + apiKey 连接 + MailContract 经 openapi
// runtime 这条路（贴 SaaS HTTP spec + 绑定填 mail 槽）。已实现，绿（原为 RED 契约，实现后转绿）。
//
// 真服务：spec.servers 指向 external-mock 的 SendGrid mock 端（**假设新端**
// /__mock/sendgrid/*，跟已有 /__mock/gcal/* 同构）。后端 openapi runtime 实打实 POST
// 到 /mail/send，mock 录下收到的 body；错误路径用 mock 的 fault 控制面逼 5xx/4xx。
// 不碰真 SendGrid。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { findCapability } from '@/fixtures/capabilities';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
// external-mock 的 SendGrid-style 发信 mock 控制面（**假设新端**，跟 /__mock/gcal/*
// 同构）：spec.servers 的 base + /__mock/sendgrid/{sent,fail,reset} 控制/读取。
const MOCK = process.env['MOCK_BASE_URL'] ?? 'http://localhost:9000';
// 控制面（e2e 经 localhost 读/武装）；spec.servers 用 service-name（backend 容器内打）。
const SENDGRID_BASE = `${MOCK}/__mock/sendgrid`;
const SENDGRID_API_BASE = 'http://external-mock:9000/__mock/sendgrid';

const OWNER = {
  email: 'openapi-mail@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'openapimail',
  fullName: 'OpenAPI Mail Owner',
};

// ─── inlined sample OpenAPI 3.0 spec (mail; SendGrid-style; servers → mock) ───
// 一个最小但合法的 3.0 spec：一个 operationId（mail.send，POST /mail/send）+ 一个
// apiKey securityScheme（bearer header，跟 SendGrid 的 `Authorization: Bearer SG.xxx`
// 同形）。servers.url 指 e2e 的 SendGrid mock，所以 openapi runtime 实打实 POST 到
// 已有/新建的 /__mock/sendgrid/mail/send，mock 录下 body 供 request-JSONata 断言。
const SENDGRID_SPEC = {
  openapi: '3.0.3',
  info: { title: 'Sample SendGrid-style Mail', version: '1.0.0' },
  servers: [{ url: SENDGRID_API_BASE }],
  paths: {
    '/mail/send': {
      post: {
        operationId: 'mail.send',
        security: [{ bearer: [] }],
        responses: {
          '202': { description: 'queued' },
          '400': { description: 'invalid recipient' },
          '500': { description: 'provider error' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      // SendGrid 用 `Authorization: Bearer SG.<key>` —— http/bearer。owner 填一个
      // token 字段（§4 认证表：http bearer → single token）。apiKey(header) 也行，
      // 两种都是「存密钥即连、无 OAuth dance」。
      bearer: { type: 'http', scheme: 'bearer' },
    },
  },
} as const;

// ─── inlined sample JSONata binding (mail; Send → POST /mail/send) ───
// category=mail、kind=openapi、把唯一契约 op `send` 映到 operationId=mail.send。
//   send.request : 契约输入 {to,subject,text} → SaaS send body
//     SendGrid 形：{ personalizations:[{ to:[{ email }] }], subject,
//                    content:[{ type:"text/plain", value }] }
//     JSONata 从契约字段构造这个嵌套形状（证明 request 方向的构造能力）。
//   send.response: SaaS 202 响应 → 契约 SendResult（这里只需 message_id；mock 回
//                    { message_id } 或 X-Message-Id header，绑定抽出归一）。
const SENDGRID_BINDING = {
  category: 'mail',
  kind: 'openapi',
  operations: {
    send: {
      op: 'mail.send',
      // request: 契约 (to,subject,text) → SendGrid send body。
      request:
        '{ "personalizations": [{ "to": [{ "email": to }] }], ' +
        '"subject": subject, ' +
        '"content": [{ "type": "text/plain", "value": body }] }',
      // response: SaaS → 契约 SendResult {id}。
      response: '{ "id": message_id }',
    },
  },
} as const;

// ─── inlined bad binding (装配期校验：声明 mail 但不真发信) ───
// category="mail" 但映的 op 不是发信操作（这里指到一个 stats 读取 op，spec 里加进来）。
// 期望装配/运行期 flag：「声明 mail 品类但 ops 不满足 MailContract.Send」。
const NON_SENDING_SPEC = {
  ...SENDGRID_SPEC,
  paths: {
    '/stats': {
      get: {
        operationId: 'mail.stats',
        security: [{ bearer: [] }],
        responses: { '200': { description: 'stats' } },
      },
    },
  },
} as const;
const NON_SENDING_BINDING = {
  category: 'mail',
  kind: 'openapi',
  operations: {
    // 把契约 send op 映到一个**读 stats** 的 op —— 不发信。
    send: { op: 'mail.stats', request: '{ "ignored": to }', response: '{ "id": "noop" }' },
  },
} as const;

// ─── target REST/diag helpers (unbuilt; §8 接口草图) ───

interface CreateResult { status: number; id?: string; error?: string }
interface ConnStatus { id: string; category: string; kind: string; has_credentials: boolean; connected: boolean }
// mock 录到的一封 SaaS send（断 request JSONata 构造出的 body 形状）。
interface SentMail {
  to: string[];
  subject: string;
  text: string;
  // raw —— mock 原样保存的 SaaS body（断嵌套构造，如 personalizations/content）。
  raw: SendGridBody;
}
interface SendGridBody {
  personalizations?: { to?: { email?: string }[] }[];
  subject?: string;
  content?: { type?: string; value?: string }[];
}
// diag 直验 mailer 经 MailContract.Send 的结果（避开访客会话，干净断形状）。
interface MailSendDiag { status: number; ok: boolean; via_kind?: string; reason?: string }

// POST /api/admin/connectors —— 从 spec+binding 建 openapi 连接器。201 → {id}；4xx → {error}。
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

// connectApiKey —— 存 bearer/apiKey 密钥（spec 派生表单）+ connect。apiKey 无 OAuth
// dance：connect 直接回 {connected:true}（§4「apiKey/basic/bearer/smtp → 直接 Connected」）。
async function connectApiKey(
  request: APIRequestContext, csrf: string, id: string,
): Promise<ConnStatus> {
  const credRes = await request.post(
    `${BACKEND}/api/admin/connectors/${encodeURIComponent(id)}/credentials`,
    { headers: { 'X-Csrftoken': csrf }, data: { token: 'SG.e2e-fake-key' } },
  );
  if (credRes.status() !== 200) throw new Error(`mail credentials: ${credRes.status()}`);
  const connectRes = await request.post(
    `${BACKEND}/api/admin/connectors/${encodeURIComponent(id)}/connect`,
    { headers: { 'X-Csrftoken': csrf }, data: {} },
  );
  if (connectRes.status() !== 200) throw new Error(`mail connect: ${connectRes.status()}`);
  const stRes = await request.get(`${BACKEND}/api/admin/connectors/${encodeURIComponent(id)}/status`);
  if (stRes.status() !== 200) throw new Error(`mail status: ${stRes.status()}`);
  return await stRes.json() as ConnStatus;
}

async function disconnectConnector(
  request: APIRequestContext, csrf: string, id: string,
): Promise<void> {
  const res = await request.post(
    `${BACKEND}/api/admin/connectors/${encodeURIComponent(id)}/disconnect`,
    { headers: { 'X-Csrftoken': csrf }, data: {} },
  );
  if (res.status() !== 200) throw new Error(`disconnect ${id}: ${res.status()}`);
}

// diagSend —— 经 MailContract.Send 发一封（diag 端直触发 mailer，归一 via_kind/ok）。
// 证明 mailer 走品类契约、底下是 openapi HTTP 一概不知。
async function diagSend(
  request: APIRequestContext, csrf: string, id: string,
  mail: { to: string; subject: string; text: string },
): Promise<MailSendDiag> {
  const res = await request.post(
    `${BACKEND}/api/admin/diag/connector/${encodeURIComponent(id)}/send`,
    { headers: { 'X-Csrftoken': csrf }, data: mail },
  );
  const json = await res.json().catch(() => ({})) as
    { ok?: boolean; via_kind?: string; reason?: string };
  return {
    status: res.status(), ok: json.ok ?? false,
    via_kind: json.via_kind, reason: json.reason,
  };
}

// ─── SendGrid mock control plane (assumed new; /__mock/sendgrid/*) ───

// getSentMail —— 读 mock 录到的所有 send（断 booker/mailer 真打到它 + body 形状）。
async function getSentMail(request: APIRequestContext): Promise<SentMail[]> {
  const res = await request.get(`${SENDGRID_BASE}/sent`);
  if (res.status() !== 200) throw new Error(`sendgrid sent: ${res.status()}`);
  return (await res.json() as { sent: SentMail[] }).sent;
}

// failNextSend —— 让 mock 的下一次 /mail/send 返指定 status（5xx 降级 / 4xx 拒）。
async function failNextSend(request: APIRequestContext, status: number): Promise<void> {
  const res = await request.post(`${SENDGRID_BASE}/fail`, { data: { status, times: 1 } });
  if (res.status() !== 200) throw new Error(`sendgrid fail arm: ${res.status()}`);
}

async function resetSendGridMock(request: APIRequestContext): Promise<void> {
  await request.post(`${SENDGRID_BASE}/reset`, { data: {} }).catch(() => undefined);
}

// assembleAndConnectMail —— 装一个 openapi mail 连接器（SendGrid spec+绑定）并连上。
// 返回 status；幂等性靠每个 test 自己 reset instance（这里不跨 test 共享）。
async function assembleAndConnectMail(
  request: APIRequestContext, csrf: string,
): Promise<ConnStatus> {
  const r = await createConnector(request, csrf, {
    spec: SENDGRID_SPEC, binding: SENDGRID_BINDING,
  });
  expect(r.status, r.error ?? '').toBe(201);
  expect(r.id).toBeTruthy();
  return connectApiKey(request, csrf, r.id!);
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
  await resetSendGridMock(request);
  return { request, csrf };
}

// ─── test bodies (extracted; the describe stays a thin wrapper) ───

// runHappyMainline —— 整条对角主干：装配 → connect(apiKey) → mail.send 解闸 →
// MailContract.Send 经 openapi runtime → SaaS mock 收到。
async function runHappyMainline(request: APIRequestContext, csrf: string): Promise<void> {
  const st = await assembleAndConnectMail(request, csrf);
  expect(st.kind, 'kind=openapi (not protocol)').toBe('openapi');
  expect(st.category).toBe('mail');
  expect(st.connected, 'apiKey connects on saving the key, no OAuth dance').toBe(true);

  // dep-gating：mail 品类槽现在 connected → mail.send cap 解闸。
  const cap = await findCapability(request, csrf, 'mail.send');
  expect(cap?.dependency?.connected, 'openapi mail connected → mail category slot connected').toBe(true);

  // mailer 经 MailContract.Send 发信，不知底下是 HTTP SaaS。
  const sent = await diagSend(request, csrf, st.id, {
    to: 'recruiter@corp.test', subject: 'OpenAPI mail', text: 'hello from SendGrid-style API',
  });
  expect(sent.status).toBe(200);
  expect(sent.ok, 'MailContract.Send succeeds via the openapi runtime').toBe(true);
  expect(sent.via_kind, 'mailer neither knows nor cares it is openapi underneath').toMatch(/openapi|http/i);

  // SaaS mock 真收到该信。
  const inbox = await getSentMail(request);
  expect(inbox, 'SendGrid mock received the mail the mailer sent').toHaveLength(1);
  expect(inbox[0]!.to).toContain('recruiter@corp.test');
  expect(inbox[0]!.subject).toBe('OpenAPI mail');
}

// runRequestConstruct —— 断 mock 录到的 raw body 是 SendGrid 嵌套形
// （personalizations/content），证明 request 方向的 JSONata 构造能力。
async function runRequestConstruct(request: APIRequestContext, csrf: string): Promise<void> {
  const st = await assembleAndConnectMail(request, csrf);
  const sent = await diagSend(request, csrf, st.id, {
    to: 'rachel@example.com', subject: 'Intro chat', text: 'Looking forward to it.',
  });
  expect(sent.ok).toBe(true);

  const inbox = await getSentMail(request);
  const ev = inbox.find((m) => m.subject === 'Intro chat');
  expect(ev, 'mock recorded the constructed send').toBeTruthy();
  // request JSONata 构造的 SendGrid 嵌套形状逐一对得上。
  const body = ev!.raw;
  expect(body.personalizations?.[0]?.to?.[0]?.email, 'to → personalizations[0].to[0].email')
    .toBe('rachel@example.com');
  expect(body.subject, 'subject mapped through directly').toBe('Intro chat');
  expect(body.content?.[0]?.type, 'text → content[0].type=text/plain').toBe('text/plain');
  expect(body.content?.[0]?.value, 'text → content[0].value').toBe('Looking forward to it.');
}

// runDegrade —— SaaS send 返指定 status（5xx 或 4xx）→ 友好降级：不崩、不泄 stack、
// reason 匹配 friendly 模式、mock 没收到信。5xx/4xx 共用，msgPattern 区分措辞。
async function runDegrade(
  request: APIRequestContext, csrf: string,
  failStatus: number, mail: { to: string; subject: string; text: string }, msgPattern: RegExp,
): Promise<void> {
  const st = await assembleAndConnectMail(request, csrf);
  await failNextSend(request, failStatus);

  const sent = await diagSend(request, csrf, st.id, mail);
  expect(sent.status, 'a provider error must not crash us into a 5xx too').toBeLessThan(500);
  expect(sent.ok, 'provider error → not successful').toBe(false);
  const msg = sent.reason ?? '';
  expect(msg, 'friendly message').toMatch(msgPattern);
  expect(msg, 'does not leak the provider raw error/stack/status code').not.toMatch(/panic|goroutine|stack|\d{3}/i);
  expect(await getSentMail(request), 'degraded/rejected → mock did not deliver successfully').toHaveLength(0);
}

// runNonSendingFlagged —— 绑定声明 category="mail" 但映的 op 不真发信。理想装配期拒，
// 兜底运行期 MailContract.Send 失败 —— 两路都接受。
async function runNonSendingFlagged(request: APIRequestContext, csrf: string): Promise<void> {
  const r = await createConnector(request, csrf, {
    spec: NON_SENDING_SPEC, binding: NON_SENDING_BINDING,
  });
  if (r.status >= 400 && r.status < 500) {
    // 理想：装配期拒。
    expect(r.error ?? '').toMatch(/mail|send|contract|operation|category/i);
    expect(r.id, 'connector not created').toBeFalsy();
    return;
  }
  // 兜底：装配过了，但运行期 MailContract.Send 必须失败（没真发出去）。
  expect(r.status, r.error ?? '').toBe(201);
  const st = await connectApiKey(request, csrf, r.id!);
  const sent = await diagSend(request, csrf, st.id, {
    to: 'recruiter@corp.test', subject: 'no-op', text: 'this op does not send',
  });
  expect(sent.ok, 'mapped to a non-send op → Send unsuccessful').toBe(false);
  expect(await getSentMail(request), 'non-send op → mock received no mail').toHaveLength(0);
}

// runDepGating —— 断开 openapi mail 连接器 → mail.send re-gate。
async function runDepGating(request: APIRequestContext, csrf: string): Promise<void> {
  const st = await assembleAndConnectMail(request, csrf);
  const before = await findCapability(request, csrf, 'mail.send');
  expect(before?.dependency?.connected, 'connected → mail slot connected').toBe(true);

  await disconnectConnector(request, csrf, st.id);
  const after = await findCapability(request, csrf, 'mail.send');
  expect(after?.dependency?.connected, 'disconnected → mail slot disconnected → mail.send re-gated').toBe(false);
}

test.describe('connector · openapi mail (SendGrid-style, kind=openapi fills the mail slot, §8 area F diagonal)', () => {
  // #155 §8-F 已落地：openapi × mail 对角（SaaS 发信 HTTP spec + JSONata 绑定填 mail 槽 +
  // apiKey 连接 + MailContract 经 openapi runtime → SendGrid-style mock）。

  let request: APIRequestContext;
  let csrf: string;

  // 每 test 重置实例 + owner + SendGrid mock（连接器跨 test 不累积；dep-gating 断绝对状态要干净）。
  test.beforeEach(async ({ playwright }) => {
    ({ request, csrf } = await initOwner(playwright));
  });
  test.afterEach(async () => { await request.dispose(); });

  // happy: 装配 openapi mail 连接器 → connect(apiKey) → mail.send cap 解闸 → MailContract 经它发信 → mock 收到。
  test('assemble openapi mail connector → connect (apiKey, no dance) → mail.send un-gates → MailContract.Send goes through it → mock received',
    async () => { await runHappyMainline(request, csrf); });

  // happy: request JSONata 把契约 {to,subject,text} 正确构造成 SaaS send body 形状。
  test('request JSONata constructs the SaaS send body shape from {to, subject, text}',
    async () => { await runRequestConstruct(request, csrf); });

  // err: connected 但 SaaS send 返 5xx → 友好降级（不崩、不泄 stack、无事件）。
  test('connected but the SaaS send returns 5xx → friendly degrade (no crash, no stack, no send recorded)',
    async () => {
      await runDegrade(
        request, csrf, 500,
        { to: 'recruiter@corp.test', subject: '5xx degrade', text: 'should fail gracefully' },
        /again|later|unavailable|mail|couldn'?t|deliver/i,
      );
    });

  // err: SaaS send 返 4xx（如 invalid recipient）→ 同样友好，不泄底层。
  test('a 4xx from the SaaS (e.g. invalid recipient rejected) → friendly (no raw provider error)',
    async () => {
      await runDegrade(
        request, csrf, 400,
        { to: 'not-an-email', subject: '4xx reject', text: 'bad recipient' },
        /recipient|address|invalid|mail|couldn'?t|deliver/i,
      );
    });

  // err: 绑定声明 category="mail" 但 spec/ops 不真发信 → 装配期（或运行期）flag。
  test('a mail binding whose spec/ops do not actually send is flagged (at assemble or runtime)',
    async () => { await runNonSendingFlagged(request, csrf); });

  // dep-gating: 断开 openapi mail 连接器 → mail.send re-gate。经「mail 作为访客 capability」，已实现。
  test('disconnect the openapi mail connector → mail.send re-gates',
    async () => { await runDepGating(request, csrf); });
});
