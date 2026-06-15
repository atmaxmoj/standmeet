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
// Backend (in the compose network) reaches Mailpit by service name on 1025.
const SMTP_HOST = process.env['MAILPIT_SMTP_HOST'] ?? 'mailpit';
const SMTP_PORT = 1025;

interface MailpitTo { Address: string }
interface MailpitMessage { ID: string; To: MailpitTo[]; Subject: string }

// MAIL_FROM —— the connector's from_address; the OTP verification email is sent
// here, so tests read the code off Mailpit at this address.
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

// readMailOTP —— pull the verification email off Mailpit and extract its 6-digit code.
export async function readMailOTP(request: APIRequestContext): Promise<string> {
  const body = await waitForMailTo(request, MAIL_FROM);
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
  request: APIRequestContext, email?: string, password?: string,
): Promise<void> {
  const { csrf } = await login(request, email, password);
  await saveMailCreds(request, csrf);
  await sendMailOTP(request, csrf);
  const code = await readMailOTP(request);
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
