// mail.ts —— mail-connector setup + Mailpit assertions for the access-code loop.
//
// configureMailConnector points the owner's SMTP at the in-network Mailpit
// catcher and verifies it (POST credentials + /test) so owner.can_email_codes
// flips true — a precondition for the gate's request-access block to show and
// for admin approve→issue→email to work. The waitForMailTo / clearMailpit
// helpers read captured mail off Mailpit's HTTP API for assertions.

import type { APIRequestContext } from '@playwright/test';

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
export interface SMTPFault {
  mode: 'connection_refused' | 'transient';
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

export async function saveMailCreds(request: APIRequestContext, csrf: string): Promise<void> {
  const res = await request.post(`${BACKEND}/api/admin/connectors/mail/credentials`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      host: SMTP_HOST, port: SMTP_PORT, username: '', password: '',
      from_address: MAIL_FROM, from_name: 'StandMeet',
    },
  });
  if (res.status() !== 200) throw new Error(`mail credentials failed: ${res.status()}`);
}

export async function sendMailOTP(request: APIRequestContext, csrf: string): Promise<void> {
  const res = await request.post(`${BACKEND}/api/admin/connectors/mail/send-otp`, {
    headers: { 'X-Csrftoken': csrf }, data: {},
  });
  if (res.status() !== 200) throw new Error(`send-otp failed: ${res.status()} ${await res.text()}`);
}

// readMailOTP —— pull the verification email (sent to the owner's address) off
// Mailpit and extract its 6-digit code.
export async function readMailOTP(request: APIRequestContext, to: string): Promise<string> {
  const body = await waitForMailTo(request, to);
  const code = /\b(\d{6})\b/.exec(body)?.[1];
  if (code === undefined) throw new Error(`no 6-digit code in OTP mail:\n${body}`);
  return code;
}

export async function verifyMailOTP(
  request: APIRequestContext, csrf: string, code: string,
): Promise<number> {
  const res = await request.post(`${BACKEND}/api/admin/connectors/mail/verify-otp`, {
    headers: { 'X-Csrftoken': csrf }, data: { code },
  });
  return res.status();
}

// configureMailConnector —— full real OTP roundtrip: save creds → send-otp →
// read the code off Mailpit → verify-otp, leaving the connector connected.
export async function configureMailConnector(
  request: APIRequestContext, email: string, password?: string,
): Promise<void> {
  const { csrf } = await login(request, email, password);
  await saveMailCreds(request, csrf);
  await sendMailOTP(request, csrf);
  const code = await readMailOTP(request, email); // OTP is sent to the owner's email
  const status = await verifyMailOTP(request, csrf, code);
  if (status !== 200) throw new Error(`verify-otp failed: ${status}`);
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
