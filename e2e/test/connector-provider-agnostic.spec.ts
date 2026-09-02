// connector-provider-agnostic.spec.ts -- #155 §8 area F (consumption loop), focused on
// provider-agnostic behavior.
//
// ⭐ the linchpin (category unification): install a **non-Google** calendar connector
// (CalDAV, kind=protocol; or a test provider) into the "calendar" category slot -> a session
// granted calendar.book still assembles calendar_book, and booking actually works --
// **without changing a single line of booker code**. This proves the consumer (booker) only
// knows CalendarContract, and has no idea whether Google / CalDAV / SMTP is behind it
// (docs/design/connector.md §2 "the contract abstracts kind away" + §5.3 consumption flow).
//
// Also covers:
//   - SMTP (kind=protocol) filling the mail category -> mailer sends via MailContract.Send, kind-agnostic.
//   - err: connector connected but runtime API 5xx -> friendly degrade (no crash, no leaked stack, no event created).
//   - dep-gating: calendar connector connect/disconnect -> calendar.book cap un-gates / re-gates
//     (via DepRegistry's global single gate, connector.md §6 + capabilities.ts dependency.connected).
//
// Covers "category unification lets any provider feed booker". Implemented, actually
// compiles, actually runs, actually goes green (booker consumes any provider through the
// category contract, no longer only recognizing a hand-rolled gcal-specific connector;
// originally a RED contract, green after implementation).
//
// Aligned to the §8 interface sketch: CalendarContract.{ListBusy,CreateEvent} /
// MailContract.Send; capabilities.ts dependency.connected; gcal-setup's connected-owner is
// reused as the control group.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { findCapability } from '@/fixtures/capabilities';
import { issueCodeWithSkills, expectCalendarBookExposed } from '@/fixtures/agent-skills-grant';
import { issueSession } from '@/fixtures/visitor';
import { scriptMockToolCall, sendAndDrain } from '@/fixtures/mock-llm-script';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
// Control plane for the non-Google calendar provider mock (CalDAV/test provider): set_busy /
// events / fail / reset, structurally identical to the gcal mock but through the provider-agnostic "calendar" category endpoint.
const CALDAV_MOCK = process.env['CALDAV_MOCK_URL'] ?? 'http://localhost:9000';
// Calls to CalDAV from inside the backend container use the service name (allowed through the SSRF allowlist); control-plane reads use localhost.
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
  // The default booking policy only allows Mon-Fri; skip to the next weekday so the slot clears the policy gate.
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

test.describe('connector · provider-agnostic consumer loop (area F)', () => {
  // #155 §8-F: category unification -- non-Google (CalDAV protocol) calendar feeds booker,
  // without changing a line of code. The SMTP mail case sends via "mail as a visitor
  // capability" (sandboxed mail-sender plugin), already implemented.

  let request: APIRequestContext;
  test.beforeAll(async ({ playwright }) => {
    request = await initOwner(playwright);
  });
  test.afterAll(async () => { await request.dispose(); });

  // ⭐ core: non-Google calendar -> booker booking succeeds, booker's code path unchanged.
  test('non-Google (CalDAV) calendar connects → calendar_book assembles + booking works (booker unchanged)',
    async () => {
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      // Install a non-gcal calendar connector into the "calendar" category slot and connect it (no OAuth dance).
      const conn = await connectCalDAVCalendar(request, csrf);

      // dep-gating: the calendar category slot is now "connected" -> the calendar.book cap un-gates.
      const cap = await findCapability(request, csrf, 'calendar.book');
      expect(cap?.dependency?.connected, 'CalDAV connected → calendar category slot connected').toBe(true);

      // Issue a code (granted calendar.book) + session.
      const code = await issueCodeWithSkills(request, csrf, { granted_skills: ['calendar.book'] });
      const visitor = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code: code.code,
        visitor_name: 'Recruiter Rachel', visitor_email: 'rachel@example.com',
      });

      // calendar_book gets assembled (category unification: the consumer doesn't know CalDAV is behind it).
      await expectCalendarBookExposed(request, visitor.session_token, true);

      // Actually book: booker goes through CalendarContract.{ListBusy,CreateEvent}, landing on the CalDAV provider.
      const start = futureSlot(7, 14);
      const tag = await scriptMockToolCall(request, {
        name: 'calendar_book',
        args: { topic: 'Provider-agnostic booking', duration_min: 30, preferred_times: [start] },
      });
      await sendAndDrain(request, visitor, `Book a 30-min chat next week?${tag}`);

      // ⭐ the event lands on the **non-Google** provider -- same booker code, different provider.
      const events = await getCalDAVEvents(request, conn.id);
      expect(events, 'CalDAV provider received the booker-created event').toHaveLength(1);
      expect(events[0]!.summary).toContain('Recruiter Rachel');
      expect(events[0]!.start).toBe(start);
      expect(events[0]!.attendees ?? [], 'attendee comes from the session profile').toContain('rachel@example.com');
    });

  // SMTP (kind=protocol) -> mailer sends via MailContract.Send, kind-agnostic. Sent via
  // "mail as a visitor capability" (mail.send, sandboxed plugin), implemented, green.
  test('SMTP connector (kind=protocol) → mailer sends via MailContract.Send (kind-agnostic)',
    async () => {
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      await connectSMTPMail(request, csrf);

      const cap = await findCapability(request, csrf, 'mail.send');
      expect(cap?.dependency?.connected, 'SMTP connected → mail category slot connected').toBe(true);

      // mailer sends one via the category contract (here through the connector's self-test send endpoint; assert sent + provider=protocol).
      const sent = await sendViaMailContract(request, csrf, {
        to: 'recruiter@corp.test', subject: 'PA mail', text: 'hello from SMTP',
      });
      expect(sent.ok, 'MailContract.Send succeeds via SMTP').toBe(true);
      expect(sent.via_kind, 'mailer neither knows nor cares it is protocol underneath').toMatch(/protocol|smtp/i);
    });

  // err: connector connected but runtime API 5xx -> friendly degrade, no crash, no leaked stack, no event created.
  test('CalDAV connected but runtime 5xx → friendly degrade (no 5xx, no stack, no event)',
    async () => {
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      const conn = await connectCalDAVCalendar(request, csrf);
      // Make the next create-event runtime call return 500 (connected but the API is down).
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

  // dep-gating: calendar connector disconnect -> cap re-gates; reconnect -> un-gates.
  test('calendar connector disconnect → calendar.book re-gated; reconnect → un-gated',
    async () => { await runDepGating(request); });
});

// ─── helpers (inline; promote to fixtures/connector-providers.ts once implementation goes green) ───

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

// runDepGating -- calendar connector connect -> un-gate, disconnect -> re-gate, reconnect -> un-gate.
// Goes through DepRegistry's global single gate (driven by capabilities.ts dependency.connected).
async function runDepGating(request: APIRequestContext): Promise<void> {
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  const conn = await connectCalDAVCalendar(request, csrf);
  const code = await issueCodeWithSkills(request, csrf, { granted_skills: ['calendar.book'] });
  const newSession = (name: string) =>
    issueSession(request, { handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: name });

  // Connected: exposed.
  await expectCalendarBookExposed(request, (await newSession('A')).session_token, true);

  // Disconnect -> the global single gate reads dependency.connected=false and gates off calendar.book.
  await disconnectConnector(request, csrf, conn.id);
  const capGated = await findCapability(request, csrf, 'calendar.book');
  expect(capGated?.dependency?.connected, 'disconnected → category slot disconnected').toBe(false);
  await expectCalendarBookExposed(request, (await newSession('B')).session_token, false);

  // Reconnect -> un-gates.
  await reconnectConnector(request, csrf, conn.id);
  await expectCalendarBookExposed(request, (await newSession('C')).session_token, true);
}

// connectCalDAVCalendar -- installs a **non-Google** calendar connector (CalDAV,
// kind=protocol) into the calendar category slot and connects it (saving credentials
// connects it immediately, no OAuth dance). Returns the connector reference.
// Idempotent: reuses an existing one -- multiple tests share the same owner instance.
async function connectCalDAVCalendar(
  request: APIRequestContext, csrf: string,
): Promise<ConnRef> {
  const id = await ensureConnector(request, csrf, {
    kind: 'protocol', protocol: 'caldav', category: 'calendar',
  });
  // Clear this collection's mock state (events/busy/fail) -- multiple tests share the same connector, so absolute counts must start clean.
  await request.post(`${CALDAV_MOCK}/__mock/caldav/${id}/reset`, { data: {} }).catch(() => undefined);
  await request.post(`${BACKEND}/api/admin/connectors/${id}/credentials`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      url: `${CALDAV_API}/caldav/${id}`, username: 'owner', password: 'pw', tls: 'none',
    },
  });
  return connectAndRead(request, csrf, id);
}

// connectSMTPMail -- installs SMTP (protocol) into the mail category slot and connects it.
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

// ensureConnector -- creates a connector, reusing one for the same category if it already exists (idempotent across tests).
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

// sendViaMailContract -- triggers MailContract.Send through the connector's self-test send
// endpoint (verifies mailer goes through the category contract and doesn't care what kind is
// underneath). Returns {ok, via_kind}.
async function sendViaMailContract(
  request: APIRequestContext, csrf: string,
  mail: { to: string; subject: string; text: string },
): Promise<MailSendResp> {
  // The address is **derived from the declaration**: `/connectors/ops/<opID with the
  // connectors. prefix stripped>`. This used to hardcode `/connectors/mail/test-send` --
  // that route lived on the generic connector registry, so a category name leaked into the
  // generic layer. Now the registry doesn't write a single category name; the name comes
  // from backend/connectors/smtp/manifest.yaml's owner_ops.
  const res = await request.post(`${BACKEND}/api/admin/connectors/ops/mail_test_send`, {
    headers: { 'X-Csrftoken': csrf }, data: mail,
  });
  if (res.status() !== 200) throw new Error(`mail test-send: ${res.status()}`);
  return await res.json() as MailSendResp;
}

// getCalDAVEvents -- reads events recorded by the non-Google provider mock (asserts booker actually landed on it).
async function getCalDAVEvents(
  request: APIRequestContext, connID: string,
): Promise<CalEvent[]> {
  const res = await request.get(`${CALDAV_MOCK}/__mock/caldav/${connID}/events`);
  if (res.status() !== 200) throw new Error(`caldav events: ${res.status()}`);
  return (await res.json() as { events: CalEvent[] }).events;
}

// failNextCalDAV -- provider mock: makes the next call to some op return the given status (runtime 5xx degrade).
async function failNextCalDAV(
  request: APIRequestContext, connID: string, op: string, status: number,
): Promise<void> {
  await request.post(`${CALDAV_MOCK}/__mock/caldav/${connID}/fail`, { data: { op, status } });
}

// callBook -- calls booker's tool endpoint directly (bypasses the LLM script, for a clean assertion on the degrade shape).
async function callBook(
  request: APIRequestContext, visitor: { conversation_id: string; session_token: string },
): Promise<{ status: number; body: BookToolResp }> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${visitor.conversation_id}/tools/calendar_book`,
    {
      headers: { Authorization: `Bearer ${visitor.session_token}` },
      // **Must not use the same slot as the earlier test**: that one already booked
      // `futureSlot(7, 14)`, and booker "reserves first, then inserts" -- the reservation
      // carries a TTL that lives in the host's capstore (the mock's reset can't clear it).
      // Colliding with it means the second call gets back `bookConflictWire{Conflict,
      // Detail}` -- **that shape has no `error` field** -- so this test would read an empty
      // string, the injected 500 never even gets a turn, and it fails red in a way that
      // looks identical to "the product had nothing to say".
      data: { topic: 'PA 5xx', duration_min: 30, preferred_times: [futureSlot(8, 15)] },
    },
  );
  return { status: res.status(), body: await res.json() as BookToolResp };
}
