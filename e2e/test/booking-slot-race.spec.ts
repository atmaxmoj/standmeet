// booking-slot-race.spec.ts — F-B-15 ⭐⭐: **the same slot must not be booked twice.**
//
// Reproduced for real in prod (2026-08-21, real Google, a live external key): two identical
// booking requests fire **at the same time**, both come back 200 with two different
// `event_id`s, and Google ends up with two side-by-side events. The owner's same half hour
// gets taken twice.
//
// The checklist item's check 5 literally says "the provider returns a conflict on a
// duplicate insert" — Google just doesn't do that (`events.insert` twice is two events, it
// never treats that as an error). But what that line is trying to guard is clear: **a
// visitor must not be double-booked.** This guard translates it into a shape this
// environment **can actually fail on**: two requests racing for the same slot.
//
// There's no mutex at the mechanism level: booking is "check busy → then insert", and
// nothing between those two steps stops a second request from reading the same "free"
// window. This isn't a provider problem — the product side is missing an "this slot already
// has someone booking it" placeholder.
//
// The criterion lives on the **calendar side**, not on the receipt
// ([[receipt-check-belongs-next-to-the-action]]): what the product says doesn't count,
// only how many events actually land with the provider. The inverse case matters just as
// much — concurrent bookings for different time slots must each still succeed, otherwise a
// "globally serialize everything, nobody gets to book concurrently" implementation could
// also turn the first assertion green ([[assertion-that-cannot-fail]]).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { createAPIToken } from '@/fixtures/admin';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { getMockEvents } from '@/fixtures/gcal';
import { seedOwnerGCalConnected, type BaseSeed } from '@/fixtures/gcal-setup';
import { callTool, initMCP } from '@/fixtures/mcp';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

interface MintResp { id: string; prefix: string; secret: string }
interface BookWire { ok?: boolean; event_id?: string; conflict?: string }
interface ToolEnvelope { result?: BookWire; reason?: string }

test.describe.serial('F-B-15 · two callers cannot take the same slot', () => {
  let seed: BaseSeed;
  let key = '';

  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(150_000);
    seed = await seedOwnerGCalConnected(playwright, {
      allowed_weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
      min_lead_days: 1,
    });
    const code = await issueCodeWithSkills(seed.request, seed.csrf, {
      granted_skills: ['calendar.book'],
    });
    const token = await createAPIToken(seed.request, seed.csrf, 'api-key-race');
    const sid = await initMCP(seed.request, token);
    await callTool(seed.request, token, sid, 'api.open', { capability_id: 'calendar.book' });
    const mint = await callTool<MintResp>(seed.request, token, sid, 'api_keys.create', {
      label: 'race-key', assumed_role_id: code.assumed_role_id,
    });
    key = mint.secret;
  });

  test.afterAll(async () => { await seed.request.dispose(); });

  test('the same slot, asked for twice at once, is booked once', async () => {
    const when = future(5, 15);
    const before = (await getMockEvents(seed.request)).length;

    const [a, b] = await Promise.all([
      book(seed.request, key, 'race one', when),
      book(seed.request, key, 'race two', when),
    ]);

    const after = await getMockEvents(seed.request);
    expect(
      after.length - before,
      'the calendar is the fact: one of the two callers got the slot, not both — a second event '
      + 'at the same time is the owner double-booked',
    ).toBe(1);

    const won = [a, b].filter((r) => r.result?.ok === true);
    expect(won.length, 'exactly one receipt says it booked').toBe(1);
    const lost = [a, b].find((r) => r.result?.ok !== true);
    expect(
      JSON.stringify(lost),
      'and the loser is told something it can act on — a time that just went is not an error '
      + 'the caller caused',
    ).toMatch(/busy|taken|conflict|unavailable/i);
  });

  test('different slots at the same moment both go through', async () => {
    const before = (await getMockEvents(seed.request)).length;

    const [a, b] = await Promise.all([
      book(seed.request, key, 'parallel one', future(6, 14)),
      book(seed.request, key, 'parallel two', future(6, 16)),
    ]);

    expect(a.result?.ok, 'first slot booked').toBe(true);
    expect(b.result?.ok, 'second slot booked').toBe(true);
    expect(
      (await getMockEvents(seed.request)).length - before,
      'holding one slot must not serialise the whole calendar',
    ).toBe(2);
  });
});

async function book(
  request: APIRequestContext, apiKey: string, topic: string, when: string,
): Promise<ToolEnvelope> {
  const res = await request.fetch(`${BACKEND}/api/pub/v1/tools/calendar_book`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    data: { topic, duration_min: 30, preferred_times: [when] },
  });
  return await res.json() as ToolEnvelope;
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
