// connector-kind-coexist.spec.ts —— #155 §1's untested "kind axis" branch: **one
// category, two kinds**.
//
// Design §1: one category can be satisfied by two kinds — `calendar` = Google(openapi)
// or CalDAV(protocol). The existing e2e (connector-provider-agnostic.spec.ts) only
// proves "install a non-gcal provider, booker doesn't change a line", but **never tests
// coexistence/slot-selection/replacement when two calendar connectors are configured at
// once**:
//   - Which one fills the "calendar" category slot? When both are connected, which
//     provider does the booker land on?
//   - What happens when a second one is connected — how does the slot hand over?
//     Disconnecting the active one — does the slot fall back, or re-gate?
//
// WARNING: the design never pins down the ownership rule for "one category slot with
// multiple kinds connected at once" (§1 only says "can be satisfied by either kind";
// §3's dep-gating names the provider through connectorDepRegistry, but says nothing
// about arbitrating multiple providers). This contract **asserts the most reasonable
// rule**:
//
//   +- Assumed SLOT-RESOLUTION RULE (implementation/owner should confirm this) --------+
//   | 1. A category slot has **exactly one ACTIVE connector at a time**. The owner     |
//   |    explicitly picks which one is active.                                        |
//   | 2. Every other same-category connector is **configured-but-inactive** (can be    |
//   |    connected, has credentials, but doesn't fill the slot).                       |
//   | 3. The consumer (booker) always runs the contract against the **ACTIVE**         |
//   |    provider only; an inactive one never receives events.                         |
//   | 4. Connecting a second calendar connector **never auto-seizes the slot** — the   |
//   |    owner must explicitly set-active to hand it over (avoiding the surprise of    |
//   |    "connecting something swaps out the production calendar"). After set-active,  |
//   |    the booker lands on the new provider.                                        |
//   | 5. dep-gating: calendar.book's gate = "**at least one ACTIVE connector is        |
//   |    connected**", **not bound to a specific provider**. Switching active between  |
//   |    two connected connectors doesn't affect whether the gate stays open.          |
//   | 6. Disconnecting the **active** one: **falls back to another connected           |
//   |    same-category connector** (auto-promoted to active), and the slot **does not  |
//   |    re-gate** (as long as a connected candidate remains). Only re-gates when       |
//   |    **no connected candidate remains at all**. <- This is the least certain rule,  |
//   |    marked as an ASSUMPTION; an implementation could instead choose "never fall    |
//   |    back, re-gate immediately, owner must set-active again" — both are left as     |
//   |    commented-out assertions below.                                              |
//   +-----------------------------------------------------------------------------------+
//
// Interface alignment §8: REST POST /api/admin/connectors (openapi `{spec,binding}` |
//   protocol `{kind,protocol,category}` → 201 {id}); …/{id}/{connect,disconnect,status};
//   GET /api/admin/connectors ({connectors:[…]}). A new **slot-selection** endpoint
//   (not in the design, proposed by this contract): POST …/{id}/activate (sets this
//   connector as its category's active one); status now also returns an `active`
//   boolean. capabilities.ts's dependency.connected drives the single global gate (§6).
//
// Covers "two kinds coexisting in one category + single active-slot arbitration +
// switching/fallback" (design §8/§1 slot rules).
// Already implemented, green (originally one of the §8 RED contract batch, turned
// green once implemented).
//
// Doesn't touch e2e/fixtures/ — reuses existing fixtures (test/admin/instance/
// capabilities/agent-skills-grant/visitor/mock-llm-script); every helper specific to
// coexistence is inlined at the end of this file.

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
// The mock control plane (events / fail / reset) goes through localhost; the backend
// container hits caldav via its service name.
const CALDAV_MOCK = process.env['CALDAV_MOCK_URL'] ?? 'http://localhost:9000';
const GCAL_MOCK = process.env['GCAL_MOCK_URL'] ?? 'http://localhost:9000';
const CALDAV_API = 'http://external-mock:9000';

const OWNER = {
  email: 'kind-coexist@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'kcowner',
  fullName: 'Kind Coexist Owner',
};

function futureSlot(daysAhead: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) { // default policy only allows weekdays
    d.setUTCDate(d.getUTCDate() + 1);
  }
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

test.describe('connector · one category, two kinds coexisting (§1 kind-axis branch)', () => {
  // #155 §1 has landed: same-category dual-kind coexistence (Google openapi + CalDAV
  // protocol) + single active-slot arbitration + switching + disconnect-active
  // fallback (promoteFallback).

  let request: APIRequestContext;
  test.beforeAll(async ({ playwright }) => {
    request = await initOwner(playwright);
  });
  test.afterAll(async () => { await request?.dispose(); });

  // Coexistence + default active: install BOTH calendar connectors (Google openapi +
  // CalDAV protocol), both connected.
  // Asserts "only one active at a time", booker lands on the active one, the other
  // receives no event.
  test('Google(openapi) + CalDAV(protocol) both fill calendar → exactly one active, booker only lands on active',
    async () => { await runBothConnectedOneActive(request); });

  // switch/replace: active switches from Google to CalDAV → slot handover, booker
  // lands on the new active.
  // Asserts "connecting the second doesn't auto-seize the slot, needs an explicit
  // activate" + the old active stops receiving events after the switch.
  test('explicit activate switches the active connector → slot handover, booker lands on the new provider (old stops receiving)',
    async () => { await runSwitchActive(request); });

  // dep-gating (not bound to a provider): both configured but both disconnected →
  // re-gate; either one becomes active+connected → un-gate. Gate condition asserted =
  // "at least one ACTIVE connector connected".
  test('dep-gating binds to "at least one active connected", not a specific provider',
    async () => { await runGatingNotProviderBound(request); });

  // disconnect ACTIVE → fall back to another connected same-category connector
  // (ASSUMPTION, see rule #6 at the top). If the implementation chooses "no fallback,
  // re-gate immediately" instead, swap the EXPECT-FALLBACK block for EXPECT-REGATE.
  test('disconnect the current active → fall back to another connected candidate (no re-gate) [assumption]',
    async () => { await runDisconnectActiveFallback(request); });

  // Edge case: disconnecting the inactive one doesn't affect the active slot (in
  // coexistence, inactive is the "spare tire" — disconnecting it has no side effect).
  test('disconnect an inactive candidate → active slot + booker unaffected',
    async () => { await runDisconnectInactiveNoop(request); });
});

// ─── test bodies (top-level so the describe callback stays short) ───

async function runBothConnectedOneActive(request: APIRequestContext): Promise<void> {
  const { csrf } = await login(request, OWNER.email, OWNER.password);

  // Both calendar connectors are configured + connected, but the owner has set Google
  // as active.
  const gcal = await connectGoogleCalendar(request, csrf);     // openapi
  const caldav = await connectCalDAVCalendar(request, csrf);   // protocol
  await activateConnector(request, csrf, gcal.id);

  // Both same-category connectors are listed, but exactly one has status.active true.
  const cals = await listConnectors(request, csrf, 'calendar');
  expect(cals.length, 'two calendar connectors coexist (config not mutually exclusive)').toBe(2);
  const actives = cals.filter((c) => c.active);
  expect(actives.length, 'exactly one active fills the slot at a time').toBe(1);
  expect(actives[0]!.id, 'owner-selected Google is active').toBe(gcal.id);

  // dep-gating: an active + connected connector → calendar.book un-gates (not bound to
  // a specific provider).
  const cap = await findCapability(request, csrf, 'calendar.book');
  expect(cap?.dependency?.connected, 'at least one active connected → slot connected').toBe(true);

  // A real booking → the event lands on ACTIVE (Google), CalDAV (inactive) receives
  // nothing.
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

  // Google active first, verifying "connecting the second (CalDAV) does not
  // auto-seize the slot".
  await activateConnector(request, csrf, gcal.id);
  let cals = await listConnectors(request, csrf, 'calendar');
  expect(activeId(cals), 'connecting the second does not auto-seize the slot — Google still active').toBe(gcal.id);

  // Explicitly switch active to CalDAV.
  await activateConnector(request, csrf, caldav.id);
  cals = await listConnectors(request, csrf, 'calendar');
  expect(activeId(cals), 'after set-active the slot hands over to CalDAV').toBe(caldav.id);
  expect(cals.filter((c) => c.active).length, 'still exactly one active after the switch').toBe(1);

  // The gate is unaffected by the switch (not bound to a specific provider).
  const cap = await findCapability(request, csrf, 'calendar.book');
  expect(cap?.dependency?.connected, 'switching active does not affect the gate staying open').toBe(true);

  // The booker now lands on the new active (CalDAV); Google receives nothing.
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

  // Starting point: an active connector connected → gate open.
  await expectGated(request, csrf, false);

  // Disconnect both → no connected candidate remains → re-gate.
  await disconnectConnector(request, csrf, gcal.id);
  await disconnectConnector(request, csrf, caldav.id);
  await expectGated(request, csrf, true);

  // Reconnecting **either one, made active**, is enough to un-gate (the gate doesn't
  // care whether it's Google or CalDAV).
  await reconnectConnector(request, csrf, caldav.id);
  await activateConnector(request, csrf, caldav.id);
  await expectGated(request, csrf, false);
}

async function runDisconnectActiveFallback(request: APIRequestContext): Promise<void> {
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  const gcal = await connectGoogleCalendar(request, csrf);
  const caldav = await connectCalDAVCalendar(request, csrf);
  // Google active, CalDAV a connected inactive candidate.
  await activateConnector(request, csrf, gcal.id);

  // Disconnect the active one (Google). CalDAV remains connected.
  await disconnectConnector(request, csrf, gcal.id);

  // -- EXPECT-FALLBACK (rule #6 assumption: auto-promotes the remaining connected
  // candidate) --
  const cals = await listConnectors(request, csrf, 'calendar');
  expect(activeId(cals), 'fallback: CalDAV auto-promotes to active').toBe(caldav.id);
  await expectGated(request, csrf, false); // still an active connector connected → no re-gate

  // The booker lands on the post-fallback active (CalDAV).
  const start = futureSlot(9, 16);
  const visitor = await codeVisitor(request, csrf, 'Fallback Fred', 'fred@example.com');
  await bookViaChat(request, visitor, start);
  const onCalDAV = await getProviderEvents(request, 'caldav', caldav.id);
  expect(onCalDAV, 'after fallback the booker lands on CalDAV').toHaveLength(1);

  // -- EXPECT-REGATE (alternate semantics: no fallback) -- if the implementation
  // chooses this instead, replace the FALLBACK block above with:
  //   expect(activeId(cals), 'no fallback → no active').toBeUndefined();
  //   await expectGated(request, csrf, true); // active disconnected → re-gate
  //   …and drop this test's booking assertion (the owner must set-active again).
}

async function runDisconnectInactiveNoop(request: APIRequestContext): Promise<void> {
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  const gcal = await connectGoogleCalendar(request, csrf);
  const caldav = await connectCalDAVCalendar(request, csrf);
  await activateConnector(request, csrf, gcal.id); // Google active, CalDAV inactive

  // Disconnect the inactive one (CalDAV).
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

// ─── inline helpers (promote to fixtures/connector-coexist.ts once the implementation turns green) ───

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

// connectGoogleCalendar —— installs a Google-style **openapi** calendar connector
// (spec+binding), fills the calendar category slot, and connects it (mock OAuth
// counts as connecting here). Idempotent: reuses an existing (category,kind) if
// present.
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
  // oauth2 dance: connect returns the consent-page URL; walk through
  // authorize→callback→token, and coming back means connected+active.
  const conn = await request.post(`${BACKEND}/api/admin/connectors/${id}/connect`, {
    headers: { 'X-Csrftoken': csrf }, data: {},
  });
  const { auth_url: authURL } = await conn.json() as { auth_url?: string };
  if (authURL) await request.get(authURL);
  const st = await request.get(`${BACKEND}/api/admin/connectors/${id}/status`);
  return await st.json() as ConnRef;
}

// connectCalDAVCalendar —— installs a non-Google **protocol** calendar connector
// (CalDAV) filling the same category slot.
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

// ensureProtocolConnector —— creates a protocol connector, reusing one that already
// exists for the same (category,kind).
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

// findExisting —— reuses the connector for the same (category,kind) (idempotent when
// tests share the same owner instance).
async function findExisting(
  request: APIRequestContext, category: string, kind: string,
): Promise<string | undefined> {
  const res = await request.get(`${BACKEND}/api/admin/connectors`);
  if (res.status() !== 200) return undefined;
  const rows = (await res.json() as { connectors?: ConnRef[] }).connectors ?? [];
  return rows.find((c) => c.category === category && c.kind === kind)?.id;
}

// listConnectors —— lists every connector under a category (there can be more than
// one in coexistence).
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

// activateConnector —— sets a connector as its category's active one (occupying the
// slot). Not listed in the design; this contract proposes POST …/{id}/activate (the
// explicit selection action for coexistence arbitration, corresponding to rule #1/#4).
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

// expectGated —— asserts whether calendar.book's dep-gate is re-gated (true = gated
// shut/disconnected).
async function expectGated(
  request: APIRequestContext, csrf: string, gated: boolean,
): Promise<void> {
  const cap = await findCapability(request, csrf, 'calendar.book');
  expect(cap?.dependency?.connected, gated ? 're-gated → disconnected' : 'open → connected')
    .toBe(!gated);
}

// codeVisitor —— issues a code granted calendar.book + a session (used repeatedly
// across coexistence tests).
async function codeVisitor(
  request: APIRequestContext, csrf: string, name: string, email: string,
): Promise<{ session_token: string; conversation_id: string }> {
  const code = await issueCodeWithSkills(request, csrf, { granted_skills: ['calendar.book'] });
  return await issueSession(request, {
    handle: OWNER.handle, mode: 'code', code: code.code,
    visitor_name: name, visitor_email: email,
  });
}

// bookViaChat —— scripts a calendar_book tool call + runs a visitor turn (the booker
// lands on the active provider).
async function bookViaChat(
  request: APIRequestContext,
  visitor: { session_token: string; conversation_id: string },
  start: string,
): Promise<void> {
  const tag = await scriptMockToolCall(request, {
    name: 'calendar_book',
    args: { topic: 'Coexist booking', duration_min: 30, preferred_times: [start] },
  });
  await sendAndDrain(
    request,
    { ...visitor, owner_handle: OWNER.handle },
    `Book a 30-min chat?${tag}`,
  );
}

// gcalRawEvent —— the shape of the gcal mock's event (start is a {dateTime} object,
// attendees is a list of {email}).
interface GcalRawEvent {
  event_id: string; summary: string;
  start?: { dateTime?: string }; attendees?: { email?: string }[];
}

// getProviderEvents —— reads the events recorded by a provider mock and normalizes
// them into CalEvent (asserts which kind the booker landed on).
// The gcal mock is global (/__mock/gcal/events, start={dateTime}); caldav is
// per-collection (start is already a string).
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
