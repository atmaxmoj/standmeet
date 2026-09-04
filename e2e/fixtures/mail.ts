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
// (simulates "SMTP service down"); subjectContains restricts the failure to mail
// whose subject matches (content-triggered).
//
// permanent —— the relay returns a 5xx **without dropping the connection**
// (address doesn't exist / rejected). It's separated from the other two modes
// because what the owner has to do differs: a 5xx won't get better after a hundred
// retries, he has to change the recipient. A dropped connection leaves only a
// transport error, with no reply code to distinguish by.
export interface SMTPFault {
  mode: 'connection_refused' | 'transient' | 'permanent';
  times?: number;
  subjectContains?: string;
}

// armSMTPFault —— make mail-mock fail the next sends per the condition
// (E8/E10/E11 + owner-notify R6).
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

// MailEnvelope —— the key info of a mail captured by Mailpit: from/to + subject +
// body. #122's confirmation-mail test asserts from (owner from_address) + to (the
// address the visitor chose).
export interface MailEnvelope {
  from: string;
  to: string[];
  subject: string;
  text: string;
  // html —— the HTML body (#122's confirmation-mail assertion checks it carries
  // schema.org JSON-LD markup).
  html: string;
}

// MAIL_FROM —— the connector's from_address (the sender). Tests asserting the
// booking-confirmation sender (#122) import it.
export const MAIL_FROM = 'noreply@standmeet.test';

// SMTP_ID —— the id of the built-in SMTP protocol connector (category=mail, kind=protocol).
const SMTP_ID = 'smtp';

// SMTP_FROM_NAME —— the sender display name (part of the credentials).
const SMTP_FROM_NAME = 'StandMeet';

// smtpCreds —— the fixed credential form for the SMTP connector (port stored as a
// string, matching the backend's smtpForm).
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

// connectMail —— the protocol connection test (really dials the SMTP handshake);
// passing → connected.
export async function connectMail(request: APIRequestContext, csrf: string): Promise<number> {
  const res = await request.post(`${BACKEND}/api/admin/connectors/${SMTP_ID}/connect`, {
    headers: { 'X-Csrftoken': csrf },
  });
  return res.status();
}

// saveMailCredsPartial —— **send only the fields the owner actually typed**, just
// like the panel.
//
// The panel's `setField` only writes the changed keys into the request body
// (`use-connector-card.ts`), so when the owner changes one port, what goes up is a
// single key `{"port":"587"}`. `saveMailCreds` always sends all seven fields, and
// therefore **can't drive** "what happens to the keys you didn't give" —— which is
// exactly the owner's real action shape (F-C-35).
export async function saveMailCredsPartial(
  request: APIRequestContext, csrf: string, fields: Record<string, string>,
): Promise<void> {
  const res = await request.post(`${BACKEND}/api/admin/connectors/${SMTP_ID}/credentials`, {
    headers: { 'X-Csrftoken': csrf },
    data: fields,
  });
  if (res.status() !== 200) throw new Error(`mail credentials (partial) failed: ${res.status()}`);
}

// MailConnectorStatus —— the two facts the panel badge reads (GET, read-only).
export interface MailConnectorStatus {
  connected: boolean;
  hasCredentials: boolean;
}

// mailConnectorStatus —— the source of the card's "connected / not connected" badge.
export async function mailConnectorStatus(
  request: APIRequestContext,
): Promise<MailConnectorStatus> {
  const res = await request.get(`${BACKEND}/api/admin/connectors/${SMTP_ID}/status`);
  if (res.status() !== 200) throw new Error(`mail status: ${res.status()}`);
  const body = await res.json() as { connected?: boolean; has_credentials?: boolean };
  return { connected: body.connected === true, hasCredentials: body.has_credentials === true };
}

// ConnectOutcome —— /connect's **receipt**: whether it connected, and if not, why.
export interface ConnectOutcome {
  connected: boolean;
  error: string;
}

// connectMailOutcome —— the same endpoint, but reads the **response body**.
//
// `connectMail` only returns the HTTP status, and this endpoint returns **200**
// even when it can't connect, writing the result in the body
// (`connectInitResp{connected,error}`) —— so "200" is not a receipt for "connected".
// A case that uses status as the receipt would carry on even when the connection
// plainly failed (that's exactly how I fell in the F-C-34 guard: connect on port 9
// returned 200, and the red landed on the assembly assertion rather than on the product).
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

// activateMail —— occupy the mail category slot (§9: sending resolves the active connector).
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
// its full envelope (from / to / subject / text). For from/to + content assertions.
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

// countMailpitMessages —— the total number of mails captured so far (for the
// "don't send → no mail" assertion).
export async function countMailpitMessages(request: APIRequestContext): Promise<number> {
  const res = await request.get(`${MAILPIT}/api/v1/messages`);
  if (res.status() !== 200) return 0;
  const body = await res.json() as { messages?: MailpitMessage[] };
  return (body.messages ?? []).length;
}

// followMailedLink —— open the link inside the mail.
//
// This is not `goto`: the address isn't assembled by the test, it's **what the
// product itself wrote into the mail**. That's exactly the thing under test ——
// whether the link we send the user actually works. So it must be followed as-is,
// with not one character completed by the test.
export async function followMailedLink(page: Page, url: string): Promise<void> {
  await page.goto(url);
}

// mailpitHasNothingTo —— the inbox has **no** mail addressed to this address.
//
// When asserting "didn't happen", it especially matters to go through the fixture
// rather than assemble a URL yourself: a wrong port (8025 vs 18025) refuses the
// connection outright, and that looks a lot like "there's really no such mail" in
// the assertion —— except this time it went red. Written otherwise it'd be an
// always-green fake assertion ([[assertion-that-cannot-fail]]).
export async function mailpitHasNothingTo(
  request: APIRequestContext, address: string,
): Promise<boolean> {
  const res = await request.get(`${MAILPIT}/api/v1/messages`);
  if (res.status() !== 200) throw new Error(`mailpit unreachable: ${res.status()}`);
  return !(await res.text()).includes(address);
}

// recoveryPhraseIn —— extract the phrase from the recovery-mail body (the
// generator prints it on a line `phrase: <...>`). Same rule as the one in
// recovery-phrase.spec.ts, so it lives in the fixture as a single copy.
export function recoveryPhraseIn(body: string): string {
  const m = /phrase:\s*([A-Za-z0-9-]+)/.exec(body);
  if (m === null) throw new Error(`no recovery phrase in the mail body:\n${body}`);
  return m[1]!;
}

// confirmLinkIn —— extract the confirmation link from the mail body. If it's not
// found, die here rather than let some later assertion go inexplicably red
// ([[read-the-failure-before-theorising]]).
export function confirmLinkIn(body: string, marker: string): string {
  const re = new RegExp(`https?://\\S*${marker}\\S*`);
  const m = re.exec(body);
  if (m === null) throw new Error(`no ${marker} link in the mail body:\n${body}`);
  return m[0].replace(/[.,)\]]+$/, '');
}
