// visitor-reschedule-booking.spec.ts —— ④: a visitor moves **their own
// conversation's** booking to a new owner-available time.
//
// Atomicity is the focus (book the new slot first, then delete the old one):
//   - happy: book T1 → reschedule to T2 (free) → exactly 1 event, at T2, the old T1 event is gone (old slot freed).
//   - atomicity: T2 already taken by someone else → rescheduling T1→T2 fails (conflict), **the original T1 booking survives intact** (the visitor isn't left with nothing).
//   - isolation (same as #123): Mallory (another member on the same code) cannot
//     reschedule Dana's booking — resolveConvBooking's conversation-ownership
//     gate blocks it, Dana's event remains.
//
// Entirely API-driven: both booking / reschedule go through tool-dispatch (the
// same backend path a card's mcp-ui:tool ends up on); the observable side
// effect is the mock GCal event (did it really run).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { getMockEvents, resetMockGCal, setMockBusy } from '@/fixtures/gcal';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const TOPIC = 'Intro call about backend work';

interface ToolBook { ok?: boolean; event_id?: string; conflict?: string }

test.describe('visitor · reschedule own booking + atomicity + isolation (④)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'], max_bookings: 9,
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('happy: reschedule to a free slot → event moves, old slot freed', async () => {
    await resetMockGCal(seed.request);
    const alice = await session(seed, 'RA-Alice', 'ra-alice@example.com');
    const booked = await book(seed.request, alice, futureWeekday(7, 10));
    expect(booked.ok, 'initial booking succeeds').toBe(true);

    const target = futureWeekday(7, 15);
    const moved = await reschedule(seed.request, alice, booked.event_id!, target);
    expect(moved.ok, 'reschedule into a free slot succeeds').toBe(true);

    const events = await getMockEvents(seed.request);
    expect(events, 'exactly one event after reschedule (old freed, new made)').toHaveLength(1);
    expect(events[0]!.event_id, 'it is a new event, not the old one').not.toBe(booked.event_id);
    expect(events[0]!.start.dateTime, 'the surviving event sits at the new time').toBe(target);
  });

  test('atomicity: reschedule into an occupied slot fails, original booking untouched', async () => {
    await resetMockGCal(seed.request);
    const bob = await session(seed, 'RA-Bob', 'ra-bob@example.com');

    const t1 = futureWeekday(8, 10);
    const t2 = futureWeekday(8, 15);
    // Mark t2 busy in the owner's FreeBusy fixture (the mock's FreeBusy is seeded, not derived
    // from inserted events) so the rebook into t2 genuinely conflicts.
    await setMockBusy(seed.request, [{ start: t2, end: plusMinutes(t2, 30) }]);

    const bobBooking = await book(seed.request, bob, t1);
    expect(bobBooking.ok, 'bob books t1 (free)').toBe(true);

    // Bob tries to move t1 → t2 (busy). Book-new-first means the rebook fails and t1 survives.
    const moved = await reschedule(seed.request, bob, bobBooking.event_id!, t2);
    expect(moved.ok, 'reschedule into a busy slot is rejected').toBe(false);

    const events = await getMockEvents(seed.request);
    expect(events.find((e) => e.event_id === bobBooking.event_id),
      'bob\'s original t1 booking is untouched (not lost)').toBeDefined();
    expect(events, 'no phantom event created (rebook failed, old kept)').toHaveLength(1);
  });

  test('isolation: another member cannot reschedule someone else\'s booking', async () => {
    await resetMockGCal(seed.request);
    const dana = await session(seed, 'RA-Dana', 'ra-dana@example.com');
    const danaBooking = await book(seed.request, dana, futureWeekday(9, 10));

    const mallory = await session(seed, 'RA-Mallory', 'ra-mallory@example.com');
    const moved = await reschedule(seed.request, mallory, danaBooking.event_id!, futureWeekday(9, 15));
    expect(moved.ok, 'mallory cannot move dana\'s booking').toBe(false);

    const events = await getMockEvents(seed.request);
    expect(events.find((e) => e.event_id === danaBooking.event_id),
      'dana\'s booking is untouched by mallory').toBeDefined();
  });
});

function session(seed: CodedSeed, name: string, email: string): Promise<VisitorSession> {
  return issueSession(seed.request, {
    handle: OWNER.handle, mode: 'code', code: seed.code.code,
    visitor_name: name, visitor_email: email,
  });
}

async function book(
  request: APIRequestContext, s: VisitorSession, time: string,
): Promise<ToolBook> {
  return dispatch(request, s, 'calendar_book',
    { topic: TOPIC, duration_min: 30, preferred_times: [time] });
}

async function reschedule(
  request: APIRequestContext, s: VisitorSession, eventID: string, time: string,
): Promise<ToolBook> {
  return dispatch(request, s, 'calendar_reschedule',
    { event_id: eventID, duration_min: 30, preferred_times: [time] });
}

async function dispatch(
  request: APIRequestContext, s: VisitorSession, tool: string, data: unknown,
): Promise<ToolBook> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${s.conversation_id}/tools/${tool}`,
    { headers: { Authorization: `Bearer ${s.session_token}` }, data },
  );
  const body = await res.json() as { result?: ToolBook };
  return body.result ?? {};
}

// futureWeekday —— **counts forward the n-th weekday** (Mon–Fri), fixed at
// hour:00 UTC. Avoids the weekend-only booking policy (weekday-only #125), so
// the slot is reliably bookable.
//
// **Counts weekdays, not "add n days then roll forward"**: the old approach
// folded different values of n onto the same day — when today is a Saturday,
// `+7` lands on a Saturday, `+8` lands on a Sunday, and both roll forward to
// **the very same Monday**. So two different cases would book the same slot,
// and `resetMockGCal` only clears the stand-in, not the product's own bookings
// and holds, so the second case gets blocked by "this slot is already taken" —
// red on "bob books a free slot", which looks like the product is broken.
// And it **only happens on certain dates**, so most of the time it looks like
// a flake (hit on Saturday 2026-08-22). Counting weekdays makes different
// values of n always land on different days.
function futureWeekday(nth: number, hour: number): string {
  const d = new Date();
  let counted = 0;
  while (counted < nth) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) counted++;
  }
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

function plusMinutes(rfc3339: string, minutes: number): string {
  return new Date(new Date(rfc3339).getTime() + minutes * 60_000).toISOString();
}
