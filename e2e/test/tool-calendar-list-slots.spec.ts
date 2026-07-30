// tool-calendar-list-slots.spec.ts —— Phase E-14c MCP parity:
// owner 在 Claude Code 调 calendar.list_slots 找可约时间。policy 拦掉
// 周末 / lead-time 内的；FreeBusy 拦掉跟现有 busy 重叠的。

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

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

  // Regression guard: a named IANA timezone (not empty / UTC) must still
  // yield slots. The backend evaluates working hours via
  // time.LoadLocation(owner.profile_timezone) — on a static CGO_ENABLED=0
  // binary in an image without tzdata that call errors and EVERY candidate
  // gets rejected (list_slots returns 0). The binary embeds `time/tzdata`
  // so this passes; this test fails loudly if that import is ever dropped.
  test('named IANA timezone (America/Toronto) still enumerates slots', async () => {
    await setBookingPolicy(seed.request, freshCsrf, { timezone: 'America/Toronto' });
    // +3/+4 days clears the 2-day lead; 14:00–22:00 UTC = 10:00–18:00 EDT,
    // inside 09:00–18:00 Toronto working hours.
    const resp = await callTool<ListSlotsResp>(
      seed.request, apiToken, sid, 'calendar.list_slots',
      { from_rfc3339: future(3, 14), until_rfc3339: future(4, 22),
        duration_min: 30, step_min: 60 },
    );
    expect(resp.slots.length).toBeGreaterThan(0);
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

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
