// booking-per-fiber-storage.spec.ts —— a storing block keeps one schema per fiber (rule 3, "one
// schema per bundle/fiber"; docs/design/plugin/per-fiber-schema.md, Execution plan T1–T6).
//
// One owner, two bundles that each hold calendar.book, one code bound to each. A visitor on each
// code books. The bookings must live apart — mcp_b_<A>_calendar_book and mcp_b_<B>_calendar_book —
// and still behave as one calendar where the product needs that:
//   T1  each bundle's booking lands in its own bundle's schema, none in the shared legacy schema
//   T3  the owner lists both bookings and cancels one by id (owner reads fan out across fibers)
//   T2  a visitor's conversation-scoped cancel touches only its own booking
//   T5  two bundles' visitors racing for one slot → one meeting (claims are not per fiber)
//   T4  max_bookings on a bundle-bound code still hides the tool once used
//   T6  deleting a bundle drops its schema and warns that stored records were dropped
//
// Before per-fiber routing every booking landed in the one mcp_calendar_book schema (T1 red).

import { test, expect } from '@/fixtures/test';

import { createAPIToken } from '@/fixtures/admin';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { callSessionTool, sessionToolNames } from '@/fixtures/blocks';
import { bundleSchema, createBundle, deleteBundleByID, type Bundle } from '@/fixtures/bundles';
import { getMockEvents } from '@/fixtures/gcal';
import { seedOwnerGCalConnected, teardownSeed, OWNER, type BaseSeed } from '@/fixtures/gcal-setup';
import { querySQL } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall, sendAndDrain } from '@/fixtures/mock-llm-script';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

const BLOCK = 'calendar.book';
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

interface OwnerBooking { id: string; google_event_id: string; visitor_email?: string }
interface Warning { kind: string; block_id: string; message: string }

let seed: BaseSeed;
let bundleA: Bundle;
let bundleB: Bundle;
let visitorA: VisitorSession;
let visitorB: VisitorSession;
let apiToken = '';
let mcpSID = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(180_000);
  seed = await seedOwnerGCalConnected(playwright, {
    allowed_weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], min_lead_days: 1,
  });
  bundleA = await createBundle(seed.request, seed.csrf, 'fiber-a', [BLOCK]);
  bundleB = await createBundle(seed.request, seed.csrf, 'fiber-b', [BLOCK]);
  visitorA = await visitorOn(bundleA, 'Visitor A', 'a@example.com');
  visitorB = await visitorOn(bundleB, 'Visitor B', 'b@example.com');
  apiToken = await createAPIToken(seed.request, seed.csrf, 'per-fiber-owner');
  mcpSID = await initMCP(seed.request, apiToken);
});
test.afterAll(async () => { await teardownSeed(seed); });

test('T1 each bundle\'s booking lands in its own bundle\'s schema', async () => {
  await book(visitorA, 'bundle A chat', futureSlot(7, 14));
  await book(visitorB, 'bundle B chat', futureSlot(7, 15));
  expect(await getMockEvents(seed.request), 'both visitors booked').toHaveLength(2);
  expect(bookingRows(bundleSchema(bundleA.id, BLOCK)), 'A\'s schema holds A\'s booking').toBe(1);
  expect(bookingRows(bundleSchema(bundleB.id, BLOCK)), 'B\'s schema holds B\'s booking').toBe(1);
  expect(bookingRows('mcp_calendar_book'), 'nothing lands in the shared legacy schema').toBe(0);
});

test('T3a the owner lists the bookings of both bundles', async () => {
  const listed = await ownerBookings();
  expect(listed.map((b) => b.visitor_email).sort()).toEqual(['a@example.com', 'b@example.com']);
});

test('T2 a visitor\'s own cancel touches only its own booking', async () => {
  const events = await getMockEvents(seed.request);
  const out = await callSessionTool(seed.request, visitorA, 'calendar_cancel', {});
  expect(out, 'visitor A cancelled its booking').toMatchObject({ cancelled: true });
  const after = await getMockEvents(seed.request);
  expect(after, 'exactly one meeting is gone').toHaveLength(events.length - 1);
  expect(after[0]!.summary, 'B\'s meeting is the one left').toContain('Visitor B');
});

test('T3b the owner cancels the other bundle\'s booking by id', async () => {
  const b = (await ownerBookings()).find((x) => x.visitor_email === 'b@example.com');
  expect(b, 'B\'s booking is listed').toBeDefined();
  const out = await callTool<{ cancelled: boolean }>(
    seed.request, apiToken, mcpSID, 'calendar.cancel_booking', { booking_id: b!.id });
  expect(out.cancelled).toBe(true);
  expect(await getMockEvents(seed.request), 'B\'s meeting is gone too').toHaveLength(0);
});

test('T5 two bundles racing for one slot get one meeting', async () => {
  const slot = futureSlot(8, 14);
  await Promise.all([book(visitorA, 'race A', slot), book(visitorB, 'race B', slot)]);
  const atSlot = (await getMockEvents(seed.request))
    .filter((e) => new Date(e.start.dateTime).getTime() === new Date(slot).getTime());
  expect(atSlot, 'one winner across bundles').toHaveLength(1);
});

test('T4 max_bookings on a bundle-bound code hides the tool once used', async () => {
  const code = await issueCodeWithSkills(seed.request, seed.csrf, {
    granted_skills: [BLOCK], bundle_id: bundleA.id, max_bookings: 1,
  });
  const first = await issueSession(seed.request, {
    handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'Quota One',
  });
  await book(first, 'quota chat', futureSlot(9, 14));
  const second = await issueSession(seed.request, {
    handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'Quota Two',
  });
  expect(await sessionToolNames(seed.request, second.session_token), 'quota used up')
    .not.toContain('calendar_book');
});

test('T6 deleting a bundle drops its schema and warns about the dropped records', async () => {
  const schema = bundleSchema(bundleA.id, BLOCK);
  expect(schemaExists(schema), 'A\'s schema exists before').toBe(true);
  await deleteBundleByID(seed.request, seed.csrf, bundleA.id);
  expect(schemaExists(schema), 'A\'s schema is dropped with the bundle').toBe(false);
  expect(schemaExists(bundleSchema(bundleB.id, BLOCK)), 'B\'s schema stays').toBe(true);
  const w = (await warnings()).find((x) => x.kind === 'data_loss' && x.message.includes('fiber-a'));
  expect(w, 'a data-loss warning names the deleted bundle').toBeTruthy();
  expect(w!.message).toMatch(/dropped \d+ stored record/);
});

async function visitorOn(b: Bundle, name: string, email: string): Promise<VisitorSession> {
  const code = await issueCodeWithSkills(seed.request, seed.csrf, {
    granted_skills: [BLOCK], bundle_id: b.id,
  });
  return issueSession(seed.request, {
    handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: name, visitor_email: email,
  });
}

async function book(v: VisitorSession, topic: string, at: string): Promise<void> {
  const tag = await scriptMockToolCall(seed.request, {
    name: 'calendar_book', args: { topic, duration_min: 30, preferred_times: [at] },
  });
  await sendAndDrain(seed.request, v, `Book me 30 minutes, please${tag}`);
}

async function ownerBookings(): Promise<OwnerBooking[]> {
  const listed = await callTool<{ bookings: OwnerBooking[] }>(
    seed.request, apiToken, mcpSID, 'bookings.list', {});
  return listed.bookings;
}

async function warnings(): Promise<Warning[]> {
  const res = await seed.request.get(`${BACKEND}/api/admin/warnings`, {
    headers: { 'X-Csrftoken': seed.csrf },
  });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { warnings: Warning[] }).warnings;
}

// bookingRows — booking documents in one schema; -1 when the schema has no records table.
function bookingRows(schema: string): number {
  const exists = querySQL(`SELECT to_regclass('${schema}.records') IS NOT NULL`);
  if (exists !== 't') return -1;
  return Number(querySQL(`SELECT count(*) FROM ${schema}.records WHERE collection = 'bookings'`));
}

function schemaExists(name: string): boolean {
  return querySQL(`SELECT 1 FROM information_schema.schemata WHERE schema_name = '${name}'`) === '1';
}

function futureSlot(daysAhead: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
