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

export async function configureMailConnector(
  request: APIRequestContext, email?: string, password?: string,
): Promise<void> {
  const { csrf } = await login(request, email, password);
  const creds = await request.post(`${BACKEND}/api/admin/connectors/mail/credentials`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      host: SMTP_HOST, port: SMTP_PORT, username: '', password: '',
      from_address: 'noreply@standmeet.test', from_name: 'StandMeet',
    },
  });
  if (creds.status() !== 200) throw new Error(`mail credentials failed: ${creds.status()}`);
  const test = await request.post(`${BACKEND}/api/admin/connectors/mail/test`, {
    headers: { 'X-Csrftoken': csrf }, data: {},
  });
  if (test.status() !== 200) {
    throw new Error(`mail test failed: ${test.status()} ${await test.text()}`);
  }
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
