// connector-binding-jsonata.spec.ts -- #155 §8 area C (declarative JSONata bindings). The
// author supplies a SaaS spec + a binding (category + per-contract-op -> operationId +
// request/response JSONata); the backend validates at assemble time and executes at
// runtime: request JSONata builds the SaaS body from the contract input; response JSONata
// extracts the contract output from the SaaS response; category fills the "calendar"/
// "mail" slot. e2e never touches real Google: the inlined spec's servers point at the
// external-mock's gcal endpoint; the response-normalization assertion goes through the
// diag endpoint, and the category-slot assertion goes through the booker's calendar_book
// assembly.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import {
  setMockBusy, getMockEvents, resetMockGCal, MOCK_GCAL_CREDS,
} from '@/fixtures/gcal';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { issueSession } from '@/fixtures/visitor';
import {
  SAMPLE_SPEC, SAMPLE_BINDING, NULL_REQUIRED_FIELD_BINDING, NESTED_ARRAY_BINDING,
  EXTRA_OP_BINDING, BROKEN_JSONATA_BINDING, GHOST_OP_BINDING, UNKNOWN_CATEGORY_BINDING,
  INCOMPLETE_BINDING,
} from '@/fixtures/connector-jsonata';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'binding-jsonata@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'bindingjsonata',
  fullName: 'Binding JSONata Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });


// --- unbuilt binding REST helpers (target contract; §8 decision sketch) ---
// POST /api/admin/connectors -- builds a connector from spec+binding. 201 -> {id}; 4xx ->
// {error}.
interface CreateResult { status: number; id?: string; error?: string }

async function createConnector(
  request: APIRequestContext, csrf: string, body: { spec: unknown; binding: unknown },
): Promise<CreateResult> {
  const res = await request.post(`${BACKEND}/api/admin/connectors`, { headers: { 'X-Csrftoken': csrf }, data: body });
  const json = await res.json().catch(() => ({})) as {
    id?: string; error?: string | { message?: string };
  };
  const err = typeof json.error === 'string' ? json.error : json.error?.message;
  return { status: res.status(), id: json.id, error: err };
}

// diag: runs the list_busy contract op for this connector, returns the normalized
// []{start,end}. Proves the response JSONata correctly extracted the contract shape from
// the SaaS shape (bypasses the visitor session, reads the runtime output directly).
interface BusyInterval { start: string; end: string }
async function diagListBusy(
  request: APIRequestContext, csrf: string, id: string, timeMin: string, timeMax: string,
): Promise<{ status: number; busy: BusyInterval[] }> {
  const r = await diagInvoke(request, csrf, id, 'calendar', 'free_busy',
    { time_min: timeMin, time_max: timeMax });
  const json = JSON.parse(r.text || '{}') as { result?: BusyInterval[] };
  return { status: r.status, busy: json.result ?? [] };
}

// --- inlined mock-shape control (assumed §8-C mock extensions; NOT in fixtures) ---
// gcal.ts's setMockBusy feeds an idealized freeBusy shape. The runtime-degradation tests
// below need to feed "malformed/missing-field/array" shapes, so this hits the mock's
// (assumed new) shape-control endpoints directly.
// Assumes external-mock adds under /__mock/gcal:
//   POST /__mock/gcal/set_freebusy_raw  { body }  -- makes the next freeBusy echo this JSON
//     verbatim
//   POST /__mock/gcal/set_event_shape   { shape:'object'|'array' } -- controls the shape
//     events.insert returns
// (fixtures untouched; land these two endpoints when implementing the mock, then fold
// these helpers into gcal.ts.)
const MOCK = process.env['MOCK_BASE_URL'] ?? 'http://localhost:9000';

// Makes the mock echo this exact JSON on the next freeBusy call (used to feed missing-
// field/shape-mismatched responses).
async function setMockFreeBusyRaw(request: APIRequestContext, body: unknown): Promise<void> {
  const res = await request.post(`${MOCK}/__mock/gcal/set_freebusy_raw`, { data: { body } });
  expect(res.status(), 'mock set_freebusy_raw').toBe(200);
}

// Makes the mock's events.insert return object (normal) or array (shape mismatch).
async function setMockEventShape(request: APIRequestContext, shape: 'object' | 'array'): Promise<void> {
  const res = await request.post(`${MOCK}/__mock/gcal/set_event_shape`, { data: { shape } });
  expect(res.status(), 'mock set_event_shape').toBe(200);
}

// diag create-event but returns {status, ref} (never throws, doesn't only look at 200) --
// for use by the degradation/rejection tests.
interface EventRef { id?: string; url?: string }
async function diagCreateEventResult(
  request: APIRequestContext, csrf: string, id: string,
  input: { title?: string; start: string; end: string; attendee: string },
): Promise<{ status: number; ref: EventRef; error?: string }> {
  const r = await diagInvoke(request, csrf, id, 'calendar', 'insert_event', {
    summary: input.title ?? '', description: '',
    start: input.start, end: input.end,
    time_zone: 'UTC', visitor_email: input.attendee,
  });
  const json = JSON.parse(r.text || '{}') as
    { result?: { event_id?: string; html_link?: string }; error?: string };
  return {
    status: r.status,
    ref: { id: json.result?.event_id, url: json.result?.html_link },
    error: json.error,
  };
}

// createOK -- POSTs a binding, asserts 201, returns the connector id. Shared by the
// (happy/runtime) tests where assembly itself isn't the thing under test, so each doesn't
// need to repeat the status assertion.
async function createOK(request: APIRequestContext, csrf: string, binding: unknown): Promise<string> {
  const r = await createConnector(request, csrf, { spec: SAMPLE_SPEC, binding });
  expect(r.status, r.error ?? '').toBe(201);
  expect(r.id).toBeTruthy();
  return r.id!;
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

// connectAndAssemble -- stores oauth2 credentials (derived from the spec) + runs the mock
// dance to connect the connector, then issues a calendar.book code + starts a visitor
// session, and returns the tool names that session assembled.
async function connectAndAssembleSession(
  request: APIRequestContext, csrf: string, id: string,
): Promise<string[]> {
  const credRes = await request.post(
    `${BACKEND}/api/admin/connectors/${encodeURIComponent(id)}/credentials`,
    { headers: { 'X-Csrftoken': csrf }, data: MOCK_GCAL_CREDS },
  );
  expect(credRes.status()).toBe(200);
  const initRes = await request.post(
    `${BACKEND}/api/admin/connectors/${encodeURIComponent(id)}/connect`,
    { headers: { 'X-Csrftoken': csrf } },
  );
  expect(initRes.status()).toBe(200);
  const { auth_url } = await initRes.json() as { auth_url: string };
  const cb = await request.get(auth_url);
  expect(cb.status()).toBe(200);

  const code = await issueCodeWithSkills(request, csrf, { granted_skills: ['calendar.book'] });
  const visitor = await issueSession(request, {
    handle: OWNER.handle, mode: 'code', code: code.code,
    visitor_name: 'Recruiter Rachel', visitor_email: 'rachel@example.com',
  });
  const diag = await request.get(`${BACKEND}/internal/diag/session`, {
    headers: { 'X-Session-Token': visitor.session_token },
  });
  expect(diag.status()).toBe(200);
  const body = await diag.json() as { tool_specs: { name: string }[] };
  return body.tool_specs.map((t) => t.name);
}

// expectRejected -- POSTs a bad binding, asserts 4xx + the error message matches +
// no connector was created. Shared by the four assemble-time rejection reasons (invalid
// JSONata / op doesn't exist / unknown category / unmapped op).
// assertResponseNormalizes -- feeds a SaaS freeBusy fixture, runs list_busy, asserts the
// normalized []{start,end} matches the two fed-in windows one-for-one (response JSONata
// extracted correctly).
async function assertResponseNormalizes(
  request: APIRequestContext, csrf: string, id: string,
): Promise<void> {
  const b0 = { start: future(2, 13), end: future(2, 14) };
  const b1 = { start: future(3, 9), end: future(3, 10) };
  await setMockBusy(request, [b0, b1]);
  const out = await diagListBusy(request, csrf, id, future(1, 0), future(4, 0));
  expect(out.status).toBe(200);
  // Compares the **instant**, not the string. The contract parses the time into a
  // time.Time and re-emits it, so milliseconds get dropped (`...:00.000Z` -> `...:00Z`) --
  // that's a serialization detail, not what this test is verifying.
  // This verifies that JSONata normalized the SaaS freeBusy shape into the contract's
  // []{start,end}.
  expect(instants(out.busy)).toEqual(instants([b0, b1]));
}

// instants -- ignores how the time string is written, looks only at the instant it names.
function instants(rows: readonly BusyInterval[]): { start: number; end: number }[] {
  return rows.map((r) => ({ start: Date.parse(r.start), end: Date.parse(r.end) }));
}

// assertRequestConstructs -- runs create_event, asserts the body the mock recorded is the
// shape request JSONata constructed (summary/start/end/attendees fields line up).
async function assertRequestConstructs(
  request: APIRequestContext, csrf: string, id: string,
): Promise<void> {
  const input = {
    title: 'Intro chat with Rachel',
    start: future(5, 15), end: future(5, 16),
    attendee: 'rachel@example.com',
  };
  expect((await diagCreateEventResult(request, csrf, id, input)).status).toBe(200);
  const events = await getMockEvents(request);
  const ev = events.find((e) => e.summary === input.title);
  expect(ev, 'mock recorded the constructed event').toBeTruthy();
  expect(ev!.start.dateTime).toBe(input.start);
  expect(ev!.end.dateTime).toBe(input.end);
  expect(ev!.attendees?.map((a) => a.email)).toContain(input.attendee);
}

// assertGracefulEmpty -- feeds a freeBusy "missing the calendars.primary.busy path", runs
// list_busy, asserts 200 + busy degrades gracefully to [] (no 5xx, no null/garbage leak).
// Shared by the missing-field and empty-object cases.
async function assertGracefulEmpty(request: APIRequestContext, csrf: string, raw: unknown): Promise<void> {
  const id = await createOK(request, csrf, SAMPLE_BINDING);
  await setMockFreeBusyRaw(request, raw);
  const out = await diagListBusy(request, csrf, id, future(1, 0), future(4, 0));
  expect(out.status, 'missing field/empty response must not 5xx').toBe(200);
  expect(out.busy, 'degrades to empty, no null/garbage leak').toEqual([]);
}

// assertCleanDegrade -- events.insert returns an array (an object was expected); asserts
// no 5xx, and either a friendly 4xx or a 200 with a cleanly-empty EventRef (never hands
// array garbage back to the consumer).
async function assertCleanDegrade(request: APIRequestContext, csrf: string): Promise<void> {
  const id = await createOK(request, csrf, SAMPLE_BINDING);
  await setMockEventShape(request, 'array');
  const out = await diagCreateEventResult(request, csrf, id, {
    title: 'Shape mismatch probe', start: future(6, 15), end: future(6, 16), attendee: 'rachel@example.com',
  });
  expect(out.status, 'shape mismatch must not 5xx').toBeLessThan(500);
  if (out.status === 200) {
    expect(out.ref.id, 'id must not be array garbage').toBeFalsy();
    expect(out.ref.url, 'url is empty likewise').toBeFalsy();
  } else {
    expect(out.error ?? '').toMatch(/shape|mapping|response|unexpected/i);
  }
}

// assertPreflightReject -- the request JSONata evaluates the required summary field to
// null; asserts a friendly pre-flight rejection (4xx, not 5xx), and that the mock never
// recorded a malformed event (nothing was actually sent out).
async function assertPreflightReject(request: APIRequestContext, csrf: string): Promise<void> {
  const id = await createOK(request, csrf, NULL_REQUIRED_FIELD_BINDING);
  await setMockEventShape(request, 'object');
  const out = await diagCreateEventResult(request, csrf, id, {
    title: 'ignored by binding', start: future(7, 15), end: future(7, 16), attendee: 'rachel@example.com',
  });
  expect(out.status, 'null required field must not 5xx').toBeLessThan(500);
  expect(out.status, 'null required field must be rejected pre-flight').toBeGreaterThanOrEqual(400);
  expect(out.error ?? '').toMatch(/summary|required|null|invalid|body/i);
  const events = await getMockEvents(request);
  expect(events.find((e) => e.summary === null as unknown as string), 'no malformed event recorded').toBeFalsy();
}

// assertNestedArrayMaps -- feeds periods[].interval{from,to}, runs list_busy, asserts the
// nested mapping + rename extracts into the contract's []{start,end} (proves JSONata's
// construction power goes beyond flat paths).
async function assertNestedArrayMaps(request: APIRequestContext, csrf: string): Promise<void> {
  const id = await createOK(request, csrf, NESTED_ARRAY_BINDING);
  const i0 = { from: future(2, 13), to: future(2, 14) };
  const i1 = { from: future(3, 9), to: future(3, 10) };
  await setMockFreeBusyRaw(request, { calendars: { primary: { periods: [{ interval: i0 }, { interval: i1 }] } } });
  const out = await diagListBusy(request, csrf, id, future(1, 0), future(4, 0));
  expect(out.status).toBe(200);
  // Same as above: compares the instant, not how the time string is written.
  expect(instants(out.busy)).toEqual(
    instants([{ start: i0.from, end: i0.to }, { start: i1.from, end: i1.to }]));
}

// assertExtraOpTolerated -- the binding also maps an op the consumer doesn't need
// (cancel_event); asserts assembly still succeeds (calendar_book shows up) and the core
// list_busy is unaffected.
async function assertExtraOpTolerated(request: APIRequestContext, csrf: string): Promise<void> {
  const id = await createOK(request, csrf, EXTRA_OP_BINDING);
  const toolNames = await connectAndAssembleSession(request, csrf, id);
  expect(toolNames).toContain('calendar_book');
  await assertResponseNormalizes(request, csrf, id);
}

async function expectRejected(
  request: APIRequestContext, csrf: string, binding: unknown, errPattern: RegExp,
): Promise<void> {
  const r = await createConnector(request, csrf, { spec: SAMPLE_SPEC, binding });
  expect(r.status).toBeGreaterThanOrEqual(400);
  expect(r.status).toBeLessThan(500);
  expect(r.error ?? '').toMatch(errPattern);
  expect(r.id, 'connector not created').toBeFalsy();
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
  await resetMockGCal(request);
  return { request, csrf };
}

test.describe('connector binding · JSONata binding (§8 area C)', () => {
  // #155 §8-C has landed: the declarative JSONata binding subsystem (POST
  // /api/admin/connectors accepts spec+binding, assemble-time validation, runtime
  // request/response JSONata).

  let request: APIRequestContext;
  let csrf: string;

  test.beforeAll(async ({ playwright }) => {
    ({ request, csrf } = await initOwner(playwright));
  });
  test.afterAll(async () => { await request.dispose(); });

  // -- happy: response JSONata normalizes SaaS freeBusy into contract []{start,end} --
  test('response JSONata normalizes SaaS freeBusy into CalendarContract.ListBusy []{start,end}',
    async () => {
      const id = await createOK(request, csrf, SAMPLE_BINDING);
      await assertResponseNormalizes(request, csrf, id);
    });

  // -- happy: request JSONata constructs the correct SaaS create-event body from the
  // contract input --
  test('request JSONata constructs the SaaS events.insert body from contract input',
    async () => {
      const id = await createOK(request, csrf, SAMPLE_BINDING);
      await assertRequestConstructs(request, csrf, id);
    });

  // -- happy: category "calendar" -> connector fills the calendar dep slot ->
  // calendar_book assembles --
  test('binding category "calendar" fills the calendar dep slot → calendar_book assembles',
    async () => {
      const id = await createOK(request, csrf, SAMPLE_BINDING);
      const toolNames = await connectAndAssembleSession(request, csrf, id);
      expect(toolNames).toContain('calendar_book');
    });

  // -- err: an invalid JSONata expression -> rejected at assemble time, connector not
  // created --
  test('invalid JSONata expression is rejected at assemble time (connector not created)',
    async () => {
      await expectRejected(request, csrf, BROKEN_JSONATA_BINDING, /jsonata|invalid|syntax/i);
    });

  // -- err: a binding referencing an operationId not in the spec -> rejected --
  test('binding referencing an operationId not in the spec is rejected',
    async () => {
      await expectRejected(request, csrf, GHOST_OP_BINDING, /freebusy\.nonexistent|operationid|not found/i);
    });

  // -- err: an unknown category -> rejected (no such category slot to fill) --
  test('binding with an unknown category is rejected',
    async () => {
      await expectRejected(request, csrf, UNKNOWN_CATEGORY_BINDING, /category|telepathy|unknown/i);
    });

  // -- err: a contract op left unmapped (incomplete binding) -> rejected/flagged --
  // The calendar contract requires both list_busy + create_event to be mapped; giving
  // only one -> incomplete.
  test('an incomplete binding (a contract op left unmapped) is rejected',
    async () => {
      await expectRejected(request, csrf, INCOMPLETE_BINDING, /create_event|unmapped|incomplete|missing/i);
    });

  // -----------------------------------------------------------------------
  // §8-C RUNTIME branches -- once assembled, how does it gracefully degrade at runtime
  // when the SaaS doesn't come back in the ideal shape?
  // The batch above is assemble-time validation; this batch specifically pins runtime
  // (missing field / shape mismatch / invalid request body / nested array mapping /
  // extra mapped op). Every test body is pulled out into a top-level helper to keep the
  // describe callback from getting too long.
  // -----------------------------------------------------------------------

  // -- err·runtime: the field response reads is missing -> gracefully becomes []
  // (no crash, no 500) --
  // The mock feeds a freeBusy without the calendars.primary.busy path; evaluating the
  // missing path -> undefined -> [].
  test('runtime missing field: freeBusy without calendars.primary.busy → ListBusy returns [] (graceful, no 5xx)',
    async () => {
      await assertGracefulEmpty(request, csrf, { kind: 'calendar#freeBusy', calendars: { primary: {} } });
    });

  // -- err·runtime: a completely empty object response {} -> gracefully becomes []
  // (undefined all the way down, no throw) --
  test('runtime null/empty response: freeBusy returns {} → ListBusy returns [] (graceful)',
    async () => {
      await assertGracefulEmpty(request, csrf, {});
    });

  // -- err·runtime: response shape mismatch (array where object was expected) -> falls
  // back and degrades, never returns garbage --
  // events.insert's response takes .id/.htmlLink (expects an object), but the mock
  // returns an array -> EventRef degrades cleanly/empty; HTTP is never 5xx, and garbage
  // is never handed back to the consumer as-is.
  test('runtime shape mismatch: events.insert returns an array (object expected) → EventRef degrades cleanly (no garbage, no 5xx)',
    async () => {
      await assertCleanDegrade(request, csrf);
    });

  // -- err·runtime: request JSONata evaluates a required field to null -> pre-flight
  // rejection/friendly error --
  // The request maps summary to a field the contract input doesn't have -> evaluates to
  // null. No malformed request is sent; rejected pre-flight instead.
  test('runtime invalid request body: required summary evaluates to null → create rejected pre-flight (friendly, no malformed call)',
    async () => {
      await assertPreflightReject(request, csrf);
    });

  // -- happy·runtime: nested array + rename mapping -> extracts correctly into
  // []{start,end} --
  // Proves JSONata's construction power goes beyond flat paths:
  // periods[].interval.{from,to} -> {start,end}.
  test('runtime nested array mapping: periods[].interval{from,to} maps correctly into []{start,end}',
    async () => {
      await assertNestedArrayMaps(request, csrf);
    });

  // -- happy: an extra op mapped that the consumer doesn't need (extra op) -> tolerated
  // (ignored), assembles as usual --
  // The booker only recognizes list_busy + create_event; mapping an extra cancel_event
  // must not block assembly.
  test('binding maps an extra op the consumer does not need → tolerated (ignored), connector still assembles',
    async () => {
      await assertExtraOpTolerated(request, csrf);
    });
});

// diagInvoke -- hits the owner-authed connector diag endpoint. **This is a backdoor that
// bypasses the real chain** (the real path is visitor chat -> agent -> booker sandbox ->
// connector.invoke), so it's **deliberately** kept inline here instead of extracted into
// a shared fixture: extracting it would license the bypass, making it easier for the next
// person to reach for it. See the "diag backdoor" task for whether this backdoor itself
// should stay or go.
async function diagInvoke(
  request: APIRequestContext, csrf: string, id: string,
  category: string, op: string, args: Record<string, unknown>,
): Promise<{ status: number; text: string }> {
  const res = await request.post(
    `${BACKEND}/api/admin/diag/connector/${encodeURIComponent(id)}/invoke`,
    { headers: { 'X-Csrftoken': csrf }, data: { category, op, args } },
  );
  return { status: res.status(), text: await res.text() };
}
