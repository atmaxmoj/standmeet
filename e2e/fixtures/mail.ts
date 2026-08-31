// mail.ts —— mail-connector setup + Mailpit assertions for the access-code loop.
//
// configureMailConnector points the owner's SMTP at the in-network Mailpit
// catcher and verifies it (POST credentials + /test) so owner.can_deliver_codes
// flips true — a precondition for the gate's request-access block to show and
// for admin approve→issue→email to work. The waitForMailTo / clearMailpit
// helpers read captured mail off Mailpit's HTTP API for assertions.

import type { APIRequestContext, Page } from '@playwright/test';

import { login } from '@/fixtures/admin';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const MAILPIT = process.env['MAILPIT_URL'] ?? 'http://localhost:18025';
// Backend (in the compose network) sends through the mail-mock SMTP fault layer on
// 1025, which forwards to Mailpit (inspection still via Mailpit's HTTP API).
const SMTP_HOST = process.env['MAILPIT_SMTP_HOST'] ?? 'mail-mock';
const SMTP_PORT = 1025;
// mail-mock control plane (host-mapped). armSMTPFault / resetSMTPFault drive it.
const MAIL_MOCK = process.env['MAIL_MOCK_URL'] ?? 'http://localhost:19400';

// SMTPFault —— arm the next send(s) to fail. times omitted = persistent until reset
// (模拟「SMTP 服务宕」); subjectContains 限定只让匹配主题的信失败（内容触发）。
//
// permanent —— 中继回一个 5xx 而**不断连接**(地址不存在 / 被拒收)。跟另外两个模式分开是因为
// owner 要做的事不一样:5xx 再试一百次也不会好,他得改收件人。断连只剩传输错,没有回码可分。
export interface SMTPFault {
  mode: 'connection_refused' | 'transient' | 'permanent';
  times?: number;
  subjectContains?: string;
}

// armSMTPFault —— 让 mail-mock 接下来的发信按条件失败（E8/E10/E11 + owner-notify R6）。
export async function armSMTPFault(request: APIRequestContext, fault: SMTPFault): Promise<void> {
  const res = await request.post(`${MAIL_MOCK}/__mock/smtp/fail`, {
    data: { mode: fault.mode, times: fault.times ?? 0, subject_contains: fault.subjectContains ?? '' },
  });
  if (res.status() !== 200) throw new Error(`arm smtp fault failed: ${res.status()}`);
}

export async function resetSMTPFault(request: APIRequestContext): Promise<void> {
  await request.post(`${MAIL_MOCK}/__mock/smtp/reset`, { data: {} });
}

interface MailpitAddr { Address: string }
interface MailpitMessage { ID: string; To: MailpitAddr[]; Subject: string }

// MailEnvelope —— 一封被 Mailpit 捕获的邮件的关键信息:收发件人 + 主题 + 正文。
// #122 的确认邮件测试断言 from(owner from_address)+ to(访客选的地址)。
export interface MailEnvelope {
  from: string;
  to: string[];
  subject: string;
  text: string;
  // html —— HTML 正文(#122 确认邮件断言里面带 schema.org JSON-LD markup)。
  html: string;
}

// MAIL_FROM —— the connector's from_address (the sender). Tests asserting the
// booking-confirmation sender (#122) import it.
export const MAIL_FROM = 'noreply@standmeet.test';

// SMTP_ID —— 内置 SMTP protocol 连接器的 id（category=mail, kind=protocol）。
const SMTP_ID = 'smtp';

// SMTP_FROM_NAME —— 发件显示名（凭据的一部分）。
const SMTP_FROM_NAME = 'StandMeet';

// smtpCreds —— SMTP 连接器的固定凭据表单（port 以字符串存，跟后端 smtpForm 一致）。
function smtpCreds(over: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    host: SMTP_HOST, port: String(SMTP_PORT), username: '', password: '',
    from_address: MAIL_FROM, from_name: SMTP_FROM_NAME, ...over,
  };
}

export async function saveMailCreds(
  request: APIRequestContext, csrf: string, over: Partial<Record<string, string>> = {},
): Promise<void> {
  const res = await request.post(`${BACKEND}/api/admin/connectors/${SMTP_ID}/credentials`, {
    headers: { 'X-Csrftoken': csrf },
    data: smtpCreds(over),
  });
  if (res.status() !== 200) throw new Error(`mail credentials failed: ${res.status()}`);
}

// connectMail —— protocol 连接测试（真去 dial SMTP 握手）；通过 → connected。
export async function connectMail(request: APIRequestContext, csrf: string): Promise<number> {
  const res = await request.post(`${BACKEND}/api/admin/connectors/${SMTP_ID}/connect`, {
    headers: { 'X-Csrftoken': csrf },
  });
  return res.status();
}

// saveMailCredsPartial —— **只发 owner 敲过的那几个字段**，跟面板一模一样。
//
// 面板的 `setField` 只把改动过的键写进请求体（`use-connector-card.ts`），所以 owner 改一个
// 端口时，上行的就是 `{"port":"587"}` 一个键。`saveMailCreds` 永远发满七个字段，因此
// **驱不出**「没给的键会怎么样」—— 而那正是 owner 真实的操作形状（F-C-35）。
export async function saveMailCredsPartial(
  request: APIRequestContext, csrf: string, fields: Record<string, string>,
): Promise<void> {
  const res = await request.post(`${BACKEND}/api/admin/connectors/${SMTP_ID}/credentials`, {
    headers: { 'X-Csrftoken': csrf },
    data: fields,
  });
  if (res.status() !== 200) throw new Error(`mail credentials (partial) failed: ${res.status()}`);
}

// MailConnectorStatus —— 面板徽标读的那两个事实（GET，只读）。
export interface MailConnectorStatus {
  connected: boolean;
  hasCredentials: boolean;
}

// mailConnectorStatus —— 卡上「connected / not connected」那个徽标的来源。
export async function mailConnectorStatus(
  request: APIRequestContext,
): Promise<MailConnectorStatus> {
  const res = await request.get(`${BACKEND}/api/admin/connectors/${SMTP_ID}/status`);
  if (res.status() !== 200) throw new Error(`mail status: ${res.status()}`);
  const body = await res.json() as { connected?: boolean; has_credentials?: boolean };
  return { connected: body.connected === true, hasCredentials: body.has_credentials === true };
}

// ConnectOutcome —— /connect 的**回执**：连上没有、没连上是为什么。
export interface ConnectOutcome {
  connected: boolean;
  error: string;
}

// connectMailOutcome —— 同一个端点，但读**响应体**。
//
// `connectMail` 只回 HTTP status，而这个端点连不上时照样返 **200**，把结果写在体里
// （`connectInitResp{connected,error}`）—— 于是「200」不是「连上了」的回执。拿 status
// 当回执的用例会在连接明明失败时照样往下走（我在 F-C-34 的守卫里正是这么栽的：
// 端口 9 上 connect 返 200，红落在装配断言上而不是产品身上）。
export async function connectMailOutcome(
  request: APIRequestContext, csrf: string,
): Promise<ConnectOutcome> {
  const res = await request.post(`${BACKEND}/api/admin/connectors/${SMTP_ID}/connect`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (res.status() !== 200) throw new Error(`mail connect: ${res.status()}`);
  const body = await res.json() as { connected?: boolean; error?: string };
  return { connected: body.connected === true, error: body.error ?? '' };
}

// activateMail —— 占用 mail 品类槽（§9：发信解析的是 active 连接器）。
async function activateMail(request: APIRequestContext, csrf: string): Promise<void> {
  const res = await request.post(`${BACKEND}/api/admin/connectors/${SMTP_ID}/activate`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (res.status() !== 200) throw new Error(`mail activate failed: ${res.status()}`);
}

// configureMailConnector —— save creds → connect(test) → activate, leaving the
// mail connector connected + owning the mail slot (so can_deliver_codes flips true).
export async function configureMailConnector(
  request: APIRequestContext, email: string, password?: string,
): Promise<void> {
  const { csrf } = await login(request, email, password);
  await saveMailCreds(request, csrf);
  const status = await connectMail(request, csrf);
  if (status !== 200) throw new Error(`mail connect failed: ${status}`);
  await activateMail(request, csrf);
}

export async function clearMailpit(request: APIRequestContext): Promise<void> {
  await request.delete(`${MAILPIT}/api/v1/messages`);
}

// waitForMailTo —— poll Mailpit for a message addressed to `to`; return its
// plain-text body. Throws after the timeout.
export async function waitForMailTo(
  request: APIRequestContext, to: string, timeoutMs = 10_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const id = await findMessageId(request, to);
    if (id !== null) return fetchMessageText(request, id);
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`no Mailpit message to ${to} within ${timeoutMs}ms`);
}

async function findMessageId(request: APIRequestContext, to: string): Promise<string | null> {
  const res = await request.get(`${MAILPIT}/api/v1/messages`);
  if (res.status() !== 200) return null;
  const body = await res.json() as { messages?: MailpitMessage[] };
  const hit = (body.messages ?? []).find((m) => m.To.some((t) => t.Address === to));
  return hit?.ID ?? null;
}

async function fetchMessageText(request: APIRequestContext, id: string): Promise<string> {
  const res = await request.get(`${MAILPIT}/api/v1/message/${id}`);
  if (res.status() !== 200) throw new Error(`fetch message ${id}: ${res.status()}`);
  const body = await res.json() as { Text?: string };
  return body.Text ?? '';
}

// waitForMailEnvelopeTo —— poll Mailpit for a message addressed to `to`, return
// its full envelope (from / to / subject / text). 给收发件人 + 内容断言用。
export async function waitForMailEnvelopeTo(
  request: APIRequestContext, to: string, timeoutMs = 10_000,
): Promise<MailEnvelope> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const id = await findMessageId(request, to);
    if (id !== null) return fetchMessageEnvelope(request, id);
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`no Mailpit message to ${to} within ${timeoutMs}ms`);
}

async function fetchMessageEnvelope(
  request: APIRequestContext, id: string,
): Promise<MailEnvelope> {
  const res = await request.get(`${MAILPIT}/api/v1/message/${id}`);
  if (res.status() !== 200) throw new Error(`fetch message ${id}: ${res.status()}`);
  const body = await res.json() as {
    From?: MailpitAddr; To?: MailpitAddr[];
    Subject?: string; Text?: string; HTML?: string;
  };
  return {
    from: body.From?.Address ?? '',
    to: (body.To ?? []).map((t) => t.Address),
    subject: body.Subject ?? '',
    text: body.Text ?? '',
    html: body.HTML ?? '',
  };
}

// countMailpitMessages —— 当前捕获到的邮件总数(给"不发 → 没邮件"断言)。
export async function countMailpitMessages(request: APIRequestContext): Promise<number> {
  const res = await request.get(`${MAILPIT}/api/v1/messages`);
  if (res.status() !== 200) return 0;
  const body = await res.json() as { messages?: MailpitMessage[] };
  return (body.messages ?? []).length;
}

// followMailedLink —— 点开信里那条链接。
//
// 这不是 `goto`：地址不是测试拼出来的，是**产品自己写进邮件里的**。这正是要验的东西 ——
// 我们发给用户的那条链接能不能真的用。所以它必须原样走，一个字符都不许由测试补全。
export async function followMailedLink(page: Page, url: string): Promise<void> {
  await page.goto(url);
}

// mailpitHasNothingTo —— 收件箱里**没有**寄给这个地址的信。
//
// 断"没发生"的时候尤其要走 fixture 而不是自己拼 URL：端口写错（8025 vs 18025）
// 时连接直接被拒，而那跟"确实没有这封信"在断言里长得很像 —— 只是这次它红了。
// 换个写法就会是一条永远绿的假断言（[[assertion-that-cannot-fail]]）。
export async function mailpitHasNothingTo(
  request: APIRequestContext, address: string,
): Promise<boolean> {
  const res = await request.get(`${MAILPIT}/api/v1/messages`);
  if (res.status() !== 200) throw new Error(`mailpit unreachable: ${res.status()}`);
  return !(await res.text()).includes(address);
}

// recoveryPhraseIn —— 从恢复邮件正文里抠出 phrase（生成端印成一行 `phrase: <...>`）。
// 与 recovery-phrase.spec.ts 里那份是同一条规则，所以放在 fixture 里只留一份。
export function recoveryPhraseIn(body: string): string {
  const m = /phrase:\s*([A-Za-z0-9-]+)/.exec(body);
  if (m === null) throw new Error(`no recovery phrase in the mail body:\n${body}`);
  return m[1]!;
}

// confirmLinkIn —— 从信正文里取出确认链接。取不到就在这里死，别让后面某个断言
// 莫名其妙地红（[[read-the-failure-before-theorising]]）。
export function confirmLinkIn(body: string, marker: string): string {
  const re = new RegExp(`https?://\\S*${marker}\\S*`);
  const m = re.exec(body);
  if (m === null) throw new Error(`no ${marker} link in the mail body:\n${body}`);
  return m[0].replace(/[.,)\]]+$/, '');
}
