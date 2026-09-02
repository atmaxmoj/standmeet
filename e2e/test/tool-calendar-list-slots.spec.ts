// tool-calendar-list-slots.spec.ts -- Phase E-14c MCP parity:
// the owner calls calendar.list_slots from Claude Code to find bookable times. Policy
// filters out weekends / times inside the lead time; FreeBusy filters out anything that
// overlaps existing busy blocks.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { setMockBusy, setBookingPolicy } from '@/fixtures/gcal';
import {
  seedOwnerGCalConnected, teardownSeed, OWNER, type BaseSeed,
} from '@/fixtures/gcal-setup';
import { createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { callTool, initMCP } from '@/fixtures/mcp';

interface ListSlotsResp { slots: Array<{ start: string; end: string }> }
interface BadArgsResp { ok: boolean; error: string; detail: string }

test.describe('Phase E-14c calendar.list_slots via MCP', () => {
  let seed: BaseSeed;
  let sid: string;
  let apiToken: string;
  // freshCsrf —— the re-login below rotates the session, so seed.csrf goes
  // stale; admin PATCHes in tests must use this one.
  let freshCsrf: string;

  test.beforeAll(async ({ playwright }) => {
    seed = await prep(playwright);
    const { csrf } = await loginAPI(seed.request, OWNER.email, OWNER.password);
    freshCsrf = csrf;
    apiToken = await createAPIToken(seed.request, csrf, 'list-slots-token');
    sid = await initMCP(seed.request, apiToken);
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('list_slots returns slots within working hours; FreeBusy filters them',
    async () => {
      const from = future(2, 8);
      const until = future(3, 20);

      const beforeBusy = await callTool<ListSlotsResp>(
        seed.request, apiToken, sid, 'calendar.list_slots',
        { from_rfc3339: from, until_rfc3339: until,
          duration_min: 30, step_min: 60 },
      );
      expect(beforeBusy.slots.length).toBeGreaterThan(0);
      // every slot should be within working hours (09:00-18:00 UTC by
      // permissive seed)
      for (const s of beforeBusy.slots) {
        const hr = new Date(s.start).getUTCHours();
        expect(hr).toBeGreaterThanOrEqual(9);
        expect(hr).toBeLessThan(18);
      }

      // mark the first 2 candidate slots' times busy → they drop
      const droppedStart = beforeBusy.slots[0]!.start;
      await setMockBusy(seed.request, [
        { start: droppedStart, end: beforeBusy.slots[0]!.end },
      ]);
      const afterBusy = await callTool<ListSlotsResp>(
        seed.request, apiToken, sid, 'calendar.list_slots',
        { from_rfc3339: from, until_rfc3339: until,
          duration_min: 30, step_min: 60 },
      );
      expect(afterBusy.slots.find((s) => s.start === droppedStart))
        .toBeUndefined();
    });

  // Bad args must be REJECTED with a stated reason — never treated as "no availability", which
  // is what an empty slot list would look like to the owner.
  //
  // The rejection now arrives as the capability's structured error payload
  // ({ok:false, error:'invalid_args', detail}) rather than the MCP isError flag. That is a
  // deliberate consequence of externalizing the tool: the sandboxed booker uses one error
  // convention for all its tools (its result wire is what the visitor cards render, and an
  // isError result gets text-prefixed, which would corrupt that JSON). Asserting the reason is
  // strictly stronger than asserting the flag — it pins WHY it was rejected, not just that it was.
  test('list_slots with bad args is rejected with a stated reason', async () => {
    const resp = await callTool<BadArgsResp>(
      seed.request, apiToken, sid, 'calendar.list_slots',
      { from_rfc3339: 'not-a-date', until_rfc3339: future(2, 9), duration_min: 30 },
    );
    expect(resp.ok).toBe(false);
    expect(resp.error).toBe('invalid_args');
    expect(resp.detail).toMatch(/from_rfc3339 parse/);
    expect(resp).not.toHaveProperty('slots');
  });

  // This test replaces the old one, "a named IANA timezone still yields slots" -- that
  // test only asked "are there still slots", and **nobody ever asked whether that
  // timezone was actually being used**, which is exactly the hole F-B-5 lives in: in
  // prod, `profile_timezone` was an empty string, so working hours were judged in UTC,
  // turning the owner's 09:00-18:00 into 05:00-18:00 in the visitor's local time, and
  // every related test was green the whole time.
  //
  // The criterion must be able to distinguish "this timezone was used" from "UTC was
  // used", so it picks a window where **the two answers are opposite**: 09:00-13:00 UTC
  // is entirely within working hours from UTC's point of view, but is 05:00-09:00
  // (before work) from Toronto's point of view.
  //
  // This also **takes over the old test's unique responsibility**: the backend goes
  // through `time.LoadLocation(owner.profile_timezone)`, and if a statically built
  // (CGO_ENABLED=0) binary doesn't bundle `time/tzdata`, this step errors out, every
  // candidate gets rejected, and the slot count drops to zero -- the **positive control**
  // below (the afternoon must have slots) is the first thing to go red in that scenario.
  test('working hours are read in the owner’s zone — a UTC-morning window is before work',
    async () => {
      await setBookingPolicy(seed.request, freshCsrf, { timezone: 'America/Toronto' });

      // Establish the positive control first: same day, same policy, the afternoon
      // window (14:00-20:00 UTC = 10:00-16:00 EDT) must have slots. Without this, the 0
      // asserted below could just as easily mean a bad window / lead time not yet cleared.
      expect(
        await countSlots(seed.request, apiToken, sid, 14, 20),
        'mid-afternoon Toronto is inside 09:00–18:00 — this window must yield slots',
      ).toBeGreaterThan(0);

      expect(
        await countSlots(seed.request, apiToken, sid, 9, 13),
        'those same clock hours are 05:00–09:00 in Toronto — offering them would be offering '
          + 'the owner’s bed, which is exactly what judging working hours in UTC did',
      ).toBe(0);
    });
});

async function prep(playwright: Playwright): Promise<BaseSeed> {
  // permissive policy: all weekdays + minimum 1-day lead → the +2/+3-day
  // window clears the lead and yields slots regardless of current weekday.
  return seedOwnerGCalConnected(playwright, {
    allowed_weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
    min_lead_days: 1,
  });
}

// countSlots -- counts how many slots fall inside a UTC window on the same day (+3 days,
// past the lead time).
// The two calls differ only in their window, so the difference between "there are slots"
// and "there aren't" can only come from policy, and the only thing moving in that policy
// is the timezone.
async function countSlots(
  request: APIRequestContext, token: string, sid: string,
  fromHourUTC: number, untilHourUTC: number,
): Promise<number> {
  const resp = await callTool<ListSlotsResp>(
    request, token, sid, 'calendar.list_slots',
    { from_rfc3339: future(3, fromHourUTC), until_rfc3339: future(3, untilHourUTC),
      duration_min: 30, step_min: 60 },
  );
  return resp.slots.length;
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
