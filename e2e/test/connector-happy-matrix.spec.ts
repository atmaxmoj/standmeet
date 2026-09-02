// connector-happy-matrix.spec.ts —— the "full closed-loop combination matrix" contract from
// #155 §8 (already implemented, green).
//
// This is the **end-to-end happy combination** grid for connector assembly: for every
// diagonal cell of kind × category × auth, the whole chain runs from the admin UI —
// **assemble** → **connect** → **the consumer actually works**. Each test = one complete
// combination, asserting only on **that one** consumer outcome; branches/errors/edge cases
// belong to their own spec files (assemble-from-ui / binding-jsonata / provider-agnostic)
// and are not repeated here.
//
// The 5 diagonal combinations covered (docs/design/connector.md §1 matrix + §4 auth + §5.2
// assembly flow):
//   1. openapi · calendar · oauth2 (Google-style) → submit spec → derived oauth2 form →
//      dance → assemble calendar.book → booker really books → event lands with the provider.
//   2. openapi · calendar · apiKey (a non-oauth calendar API) → submit spec → apiKey form →
//      no dance → calendar.book really runs.
//   3. protocol · calendar · CalDAV → pick the built-in card → fixed form → connect →
//      calendar.book really runs.
//   4. openapi · mail · bearer → submit spec → bearer form → connect → mail.send
//      (MailContract) really sends.
//   5. protocol · mail · SMTP → pick the built-in card → fixed form → connect → mail.send
//      really sends.
//
// The spec-driven assembly UI + derived forms + each auth's connect flow + category-unified
// consumption are all implemented (§8 phase-one spine A+B+D+F), all five cells green
// (originally a RED contract meant to go green cell by cell).
//
// Interface (§8's target interface, real testids): admin-nav-connectors / connector-add-open /
// connector-card-{category} / connector-spec-input / connector-spec-submit /
// connector-scheme-select / connector-field-{key} / connector-connect-button /
// connector-status; REST GET /api/admin/connectors (to get {id}); diag/consumer go through
// the API.
//
// Convention: the UI drives assembly (adminPage, no page.goto, entered by clicking through
// admin-nav-connectors), the API asserts the consumer outcome. Helpers are inlined (a thin
// version of the gold pattern), fixtures/ is left untouched.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@/fixtures/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { findCapability } from '@/fixtures/capabilities';
import { issueCodeWithSkills, expectCalendarBookExposed } from '@/fixtures/agent-skills-grant';
import { issueSession } from '@/fixtures/visitor';
import { scriptMockToolCall, sendAndDrain } from '@/fixtures/mock-llm-script';
import { activateConnector } from '@/fixtures/connector-card';
import {
  setCalDAVBusy, busyStyleComponent, busyStyleProperty,
  getCalDAVEvents as getCalDAVEventsIn, resetCalDAV as resetCalDAVIn,
} from '@/fixtures/caldav-mock';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
// Mock control plane: gcal (oauth2 calendar) / caldav (protocol calendar) / smtp+mailpit
// (mail) all sit on the same external-mock origin; the apiKey/bearer calendar/mail APIs reuse
// the gcal mock endpoint (servers points there, only the securityScheme differs → the same
// runtime hits the same recorder). MOCK — the address the test script (node) + browser use
// (host machine → localhost); MOCK_API — the address written into the spec for the backend
// container to use (the docker network name external-mock, on the SSRF allowlist). Both point
// at the same mock (mapped to host port 9000), so events/mail the backend writes can still be
// read back by the node control endpoint. One name resolves differently for three parties,
// so they're kept separate.
const MOCK = process.env['MOCK_BASE_URL'] ?? 'http://localhost:9000';
const MOCK_API = process.env['MOCK_API_URL'] ?? 'http://external-mock:9000';
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
// Shares one minimal set of calendar/mail paths; only the securitySchemes change (the auth
// axis). servers points at the mock.

const CAL_PATHS = {
  '/freeBusy': { post: { operationId: 'freebusy.query', responses: { '200': { description: 'ok' } } } },
  '/events': { post: { operationId: 'events.insert', responses: { '200': { description: 'ok' } } } },
} as const;

// combo 1: openapi calendar + oauth2 (Google-style: after filling in the fields, there's a
// Connect dance).
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

// combo 2: openapi calendar + apiKey (a non-oauth calendar API: fill in one key, no dance).
const APIKEY_CAL_SPEC = {
  openapi: '3.0.3',
  info: { title: 'ApiKey Calendar', version: '1.0.0' },
  servers: [{ url: `${MOCK_API}/__mock/gcal` }],
  paths: CAL_PATHS,
  components: {
    securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'X-Api-Key' } },
  },
} as const;

// combo 4: openapi mail + bearer (token in Authorization: Bearer, no dance).
const BEARER_MAIL_SPEC = {
  openapi: '3.0.3',
  info: { title: 'Bearer Mail', version: '1.0.0' },
  servers: [{ url: `${MOCK_API}/__mock/mailapi` }],
  paths: { '/send': { post: { operationId: 'messages.send', responses: { '202': { description: 'ok' } } } } },
  components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
} as const;

// Bindings (declarative JSONata, hand-authored). calendar has two ops, mail has one.
const CAL_BINDING = {
  category: 'calendar', kind: 'openapi',
  operations: {
    list_busy: {
      op: 'freebusy.query',
      request: '{ "timeMin": timeMin, "timeMax": timeMax, "items": [{ "id": "primary" }] }',
      response: 'calendars.primary.busy.{ "start": start, "end": end }',
    },
    create_event: {
      // The contract's variable names match CalendarProxy.CreateEvent (summary / start /
      // end / visitorEmail).
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

// ─── helpers (inline thin; promote to fixtures/ once fully implemented and green) ───
interface ConnRef { id: string; category: string; kind: string; connected: boolean }
interface CalEvent { summary: string; start: string; attendees?: string[] }
interface MailMsg { to: string[]; subject: string }

// ─── UI assemble drivers (no page.goto; click admin-nav-connectors → add) ───

// openByCategory — enters the connectors area, clicks "add", picks a card by category
// (openapi: the spec-driven candidate card; protocol: a built-in protocol card). Returns
// that card's locator for the following form fill / connect steps.
async function openAddCard(page: Page, category: string) {
  await page.getByTestId('admin-nav-connectors').click();
  await page.getByTestId('connector-add-open').click();
  await page.getByTestId(`connector-card-${category}`).click();
}

// assembleOpenAPI — submits spec+binding (connector-spec-input/submit) → (if multiple
// schemes) picks a scheme → fills in the derived fields → connects. Returns that connector
// (fetched via GET /api/admin/connectors for the newest {id}).
async function assembleOpenAPI(
  page: Page, request: APIRequestContext, opts: {
    category: string; spec: unknown; binding: unknown;
    scheme?: string; fields: Record<string, string>; needsDance: boolean;
  },
): Promise<ConnRef> {
  const before = await connectorIdSet(request);
  await openAddCard(page, opts.category);
  // spec / binding are two separate fields; validate and assemble are two separate buttons
  // (after F-C-21 there's only one implementation left).
  await page.getByTestId('connector-spec-input').fill(JSON.stringify(opts.spec));
  await page.getByTestId('connector-binding-input').fill(JSON.stringify(opts.binding));
  await page.getByTestId('connector-spec-submit').click();
  await expect(page.getByTestId('connector-candidate')).toBeVisible();
  // The selector only appears when there's more than one scheme (§7 decision #3). A
  // single-scheme spec doesn't show it, and the auth_scheme that assembly submits is taken
  // from the derived form's first entry — which is the only one. So: "pick it if it's there,
  // otherwise it's already the one."
  await pickSchemeIfOffered(page, opts.scheme);
  for (const [k, v] of Object.entries(opts.fields)) {
    await page.getByTestId(`connector-field-${k}`).fill(v);
  }
  // After assembling, the modal **doesn't close**: the ingest form gives way to the new
  // connector's card (credentials + Connect have always been that card's job). Closing it
  // would leave the owner on a list row they can't connect from — a ConnectorList row only
  // has category/status/delete.
  await page.getByTestId('connector-assemble-button').click();
  await page.getByTestId('connector-connect-button').click();
  // Dance: the whole page navigates away to the provider's consent page and back
  // (waitForURL might match early just because we're already on /admin/connectors — the
  // polling in newConnector absorbs the delay before the callback lands in storage).
  // Non-dance: connects in place, status flips straight to connected.
  if (opts.needsDance) await page.waitForURL('**/admin/connectors**');
  else await expect(page.getByTestId('connector-status')).toHaveText(/connected|已连接/i);
  return newConnector(request, before, opts.category);
}

// pickSchemeIfOffered — picks the given scheme if the selector exists; does nothing if it
// doesn't (the spec only declares one). Doesn't judge with `.count()` directly: right after
// the candidate renders, the selector may not be mounted yet, so count() could read 0 when
// it's about to appear. Wait first for it to either "appear or be confirmed absent", then
// decide.
async function pickSchemeIfOffered(page: Page, scheme?: string): Promise<void> {
  if (!scheme) return;
  const select = page.getByTestId('connector-scheme-select');
  await expect(page.getByTestId('connector-cred-form')).toBeVisible();
  if (await select.count() > 0) await select.selectOption(scheme);
}

// assembleProtocol — picks the built-in protocol card (fixed form, no spec) → fills in the
// fixed fields → connects.
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

// connectorIdSet — takes a snapshot of "existing connector ids" before assembly, so the
// newly created one can be diffed out afterward.
async function connectorIdSet(request: APIRequestContext): Promise<Set<string>> {
  const res = await request.get(`${BACKEND}/api/admin/connectors`);
  if (res.status() !== 200) throw new Error(`list connectors: ${res.status()}`);
  const rows = (await res.json() as { connectors?: ConnRef[] }).connectors ?? [];
  return new Set(rows.map((c) => c.id));
}

// newConnector — polls until a connected connector of this category shows up that wasn't in
// the before snapshot (= the one just assembled). Multiple combos share one owner: taking
// "the first connected" by category would grab an earlier combo's connector (causing the
// wrong connector to be activated, the booker to hit the wrong provider); pinpointing by
// "newly appeared id" is the correct approach.
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

// futureSlot — hour:00, N **weekdays** ahead (skipping weekends). The owner's default
// booking policy only allows weekdays (calendar_policy weekdayAllowed), so the slot must
// land on a weekday; a naive "today + N calendar days" occasionally lands on a Saturday or
// Sunday depending on the run date → the policy rejects it → the booker fails to book
// (a date-fragile flake — this exact spec broke that way when it ran on a Thursday with
// daysAhead=9 landing on a Saturday). Counting weekdays makes each distinct N land on a
// distinct weekday, independent of the run date.
function futureSlot(weekdaysAhead: number, hour: number): string {
  const d = new Date();
  let counted = 0;
  while (counted < weekdaysAhead) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) counted++; // skip Sun(0) / Sat(6)
  }
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

// ─── consumer assertions (the ONE outcome per combo) ──────────────────────

// bookOnce — issues a calendar.book code + session → assembles calendar_book → really
// books once.
async function bookOnce(
  request: APIRequestContext, csrf: string, start: string,
): Promise<void> {
  const code = await issueCodeWithSkills(request, csrf, { granted_skills: [...CAL_TOOLS] });
  const visitor = await issueSession(request, {
    handle: OWNER.handle, mode: 'code', code: code.code,
    visitor_name: 'Recruiter Rachel', visitor_email: 'rachel@example.com',
  });
  await expectCalendarBookExposed(request, visitor.session_token, true);
  const tag = await scriptMockToolCall(request, {
    name: 'calendar_book',
    args: { topic: 'Happy matrix booking', duration_min: 30, preferred_times: [start] },
  });
  await sendAndDrain(request, visitor, `Book a 30-min chat next week?${tag}`);
}

// bookAndAssert — the shared tail for calendar combos: asserts the category slot is
// connected → really books once → asserts the event landed with the provider (the attendee
// comes from the session profile). Each calendar test only varies the assembly step.
async function bookAndAssert(
  request: APIRequestContext, csrf: string, daysAhead: number,
  readEvents: (r: APIRequestContext) => Promise<CalEvent[]> = getEvents,
): Promise<void> {
  const cap = await findCapability(request, csrf, 'calendar.book');
  expect(cap?.dependency?.connected, 'calendar category slot connected').toBe(true);
  const start = futureSlot(daysAhead, 14);
  await bookOnce(request, csrf, start);
  const events = await readEvents(request);
  expect(events, 'provider received the booker-created event').toHaveLength(1);
  expect(events[0]!.start).toBe(start);
  expect(events[0]!.attendees ?? []).toContain('rachel@example.com');
}

const CALDAV_COLL = 'hmcal';

// The CalDAV mock helpers live in fixtures/caldav-mock.ts — since this spec's collection is
// fixed, they're wrapped locally here to avoid passing the same two parameters every time.
const getCalDAVEvents = (r: APIRequestContext) => getCalDAVEventsIn(r, MOCK, CALDAV_COLL);
const resetCalDAV = (r: APIRequestContext) => resetCalDAVIn(r, MOCK, CALDAV_COLL);

// caldavComboBooks — the protocol · calendar · CalDAV cell: assemble → activate → really
// book once, landing in its collection. **Must explicitly activate**: an earlier combo has
// already claimed the calendar slot, and connecting doesn't automatically take it over —
// otherwise the booker would still hit the old gcal connector and the event would land in
// the gcal store instead of the CalDAV collection.
async function caldavComboBooks(page: Page, request: APIRequestContext): Promise<void> {
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  await resetCalDAV(request);
  const conn = await assembleCalDAV(page, request);
  await activateConnector(request, csrf, conn.id);
  await bookAndAssert(request, csrf, 9, getCalDAVEvents);
}

// assembleCalDAV — the built-in CalDAV card + fixed fields; url points at the collection
// (the backend container reaches it through MOCK_API).
async function assembleCalDAV(page: Page, request: APIRequestContext): Promise<ConnRef> {
  return assembleProtocol(page, request, {
    category: 'calendar',
    fields: {
      url: `${MOCK_API}/caldav/${CALDAV_COLL}`, username: 'owner', password: 'pw', tls: 'none',
    },
  });
}

// busyWindowBlocksEitherShape — three steps, carries its own positive control:
//   ① the already-supported shape must block the slot (proves the "block busy times"
//      mechanism itself works)
//   ② a free slot must still be bookable (otherwise ①'s zero result might just mean
//      "booking is entirely broken")
//   ③ the same hour, in the real server's shape, must still block — a red here can only mean
//      "that shape of response wasn't parsed"
async function busyWindowBlocksEitherShape(page: Page, request: APIRequestContext): Promise<void> {
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  await resetCalDAV(request);
  const conn = await assembleCalDAV(page, request);
  await activateConnector(request, csrf, conn.id);

  const busy = futureSlot(10, 10);

  await busyOn(request, busy, busyStyleProperty);
  await bookOnce(request, csrf, busy);
  expect(
    await getCalDAVEvents(request),
    'a busy hour reported as a FREEBUSY property must not be booked over',
  ).toHaveLength(0);

  await bookOnce(request, csrf, futureSlot(10, 14));
  expect(
    await getCalDAVEvents(request),
    'control: a free hour on this very calendar does book',
  ).toHaveLength(1);

  await busyOn(request, busy, busyStyleComponent);
  await bookOnce(request, csrf, busy);
  expect(
    await getCalDAVEvents(request),
    'the same busy hour, reported as VFREEBUSY components, must still block',
  ).toHaveLength(1);
}

// busyOn — this spec's collection is fixed; the helper lives in fixtures/caldav-mock.ts.
async function busyOn(
  request: APIRequestContext, start: string, style: string,
): Promise<void> {
  await setCalDAVBusy(request, MOCK, CALDAV_COLL, start, style);
}

// getEvents — reads the events the calendar provider mock recorded (the gcal mock captures
// every calendar combo).
interface RawEvent { summary: string; start: { dateTime: string }; attendees?: { email: string }[] }

async function getEvents(request: APIRequestContext): Promise<CalEvent[]> {
  const res = await request.get(`${MOCK}/__mock/gcal/events`);
  if (res.status() !== 200) throw new Error(`mock events: ${res.status()}`);
  // The mock stores it in gcal's shape (start.dateTime / attendees[].email); flatten it into
  // the flat shape the assertions use.
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

// mailViaContract — triggers MailContract.Send through the mail category slot's test-send,
// asserts Mailpit received it.
async function expectMailSent(
  request: APIRequestContext, csrf: string, to: string, subject: string,
): Promise<void> {
  const cap = await findCapability(request, csrf, 'mail.send');
  expect(cap?.dependency?.connected, 'mail category slot connected').toBe(true);
  // The address is derived from the connector's own declaration (smtp's manifest.yaml →
  // connectors.mail_test_send), no longer hardcoded as `/connectors/mail/test-send` on the
  // generic registry.
  const res = await request.post(`${BACKEND}/api/admin/connectors/ops/mail_test_send`, {
    headers: { 'X-Csrftoken': csrf }, data: { to, subject, text: 'hello from matrix' },
  });
  expect(res.status(), 'MailContract.Send 200').toBe(200);
  const msg = await waitForMail(request, to);
  expect(msg?.subject, 'Mailpit received the mail sent via MailContract').toBe(subject);
}

// waitForMail — polls Mailpit (expect.poll's backoff, not setTimeout-as-sleep) until the
// mail is received.
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

test.describe('connector · happy combination matrix (kind × category × auth full loop)', () => {
  // Covers the spec-driven assembly UI + derived forms + each auth's connect flow +
  // category-unified consumption (docs/design/connector.md §8 phase-one A+B+D+F).
  // Already implemented, all five cells green.

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

  // combo 1 —— openapi · calendar · oauth2 (Google-style): spec → derived oauth2 form →
  // dance → assemble calendar_book → booker really books → event lands with the provider.
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

  // combo 2 —— openapi · calendar · apiKey (a non-oauth calendar API): spec → apiKey form →
  // no-dance connect → calendar_book really runs.
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

  // combo 3 —— protocol · calendar · CalDAV: built-in card → fixed form → connect →
  // explicit activate → book. An earlier combo has already claimed the calendar slot
  // (connecting doesn't auto-take-over), so this test explicitly activates this caldav and
  // confirms it — only then does the booker actually use it (landing in the CalDAV mock's
  // collection, not the gcal store).
  test('protocol calendar (CalDAV): pick built-in card → fixed form → booker books',
    ({ adminPage: page }) => caldavComboBooks(page, request));

  // F-C-50 —— **a real server writes a busy time as a VFREEBUSY component (DTSTART/DTEND),
  // and the product treats it as "the whole day is free".**
  //
  // ①🔴 hit for real in prod: connected to a real Radicale, whose calendar has a
  // once-weekly Monday meeting (Europe/Berlin 16:00 = Eastern 10:00, falling inside the
  // bookable window). A visitor asks about that day's open slots → the product reports 18
  // slots, 9:00–18:00 unbroken, saying *"a clean run available … with no gaps"*, with the
  // 10:00 slot right inside it.
  //
  // ②🎯 `caldav_client.go`'s `freeBusyValue` only recognizes lines starting with `FREEBUSY`
  // and only UTC `<start>/<end>`; Radicale doesn't produce a single `FREEBUSY:` line, so 0
  // busy times get parsed out. And the line next to it — "skip lines that can't be parsed
  // (graceful degrade, don't crash)" — turns **"I don't understand this answer" into "this
  // calendar is empty"** — for this field, those are the opposite of each other
  // ([[empty-is-not-json-null]]).
  //
  // The mock is taught the rule first: `set_busy` now accepts a `style`, and the `component`
  // variant is exactly how Radicale answers ([[stand-in-is-politer-than-reality]]).
  //
  // **Carries its own positive control**: book successfully into a free slot first, then try
  // to book into the busy one. Without that first step, "couldn't book" for any reason at
  // all would make this test go green ([[red-in-the-wrong-place]]).
  test('a busy window reported as VFREEBUSY components still blocks that slot (F-C-50)',
    ({ adminPage: page }) => busyWindowBlocksEitherShape(page, request));

  // combo 4 —— openapi · mail · bearer: spec → bearer form → connect → mail.send really sends.
  test('openapi mail + bearer: assemble → bearer form → MailContract.Send delivers',
    async ({ adminPage: page }) => {
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      await assembleOpenAPI(page, request, {
        category: 'mail', spec: BEARER_MAIL_SPEC, binding: MAIL_BINDING,
        scheme: 'bearer', fields: { token: 'mock-mail-bearer-token' }, needsDance: false,
      });
      await expectMailSent(request, csrf, 'recruiter@corp.test', 'Matrix bearer mail');
    });

  // combo 5 —— protocol · mail · SMTP: built-in card → fixed form → connect → mail.send
  // really sends.
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
