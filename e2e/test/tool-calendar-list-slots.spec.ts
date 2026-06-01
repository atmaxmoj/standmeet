// tool-calendar-list-slots.spec.ts —— Phase E-14c MCP parity:
// owner 在 Claude Code 调 calendar.list_slots 找可约时间。policy 拦掉
// 周末 / lead-time 内的；FreeBusy 拦掉跟现有 busy 重叠的。

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { setMockBusy } from '@/fixtures/gcal';
import {
  seedOwnerGCalConnected, teardownSeed, OWNER, type BaseSeed,
} from '@/fixtures/gcal-setup';
import { createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { callTool, initMCP } from '@/fixtures/mcp';

interface ListSlotsResp { slots: Array<{ start: string; end: string }> }

test.describe('Phase E-14c calendar.list_slots via MCP', () => {
  let seed: BaseSeed;
  let sid: string;
  let apiToken: string;

  test.beforeAll(async ({ playwright }) => {
    seed = await prep(playwright);
    const { csrf } = await loginAPI(seed.request, OWNER.email, OWNER.password);
    apiToken = await createAPIToken(seed.request, csrf, 'list-slots-token');
    sid = await initMCP(seed.request, apiToken);
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('list_slots returns slots within working hours; FreeBusy filters them',
    async () => {
      const from = future(1, 8);
      const until = future(2, 20);

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

  test('list_slots with bad args returns isError', async () => {
    await expect(
      callTool(seed.request, apiToken, sid, 'calendar.list_slots',
        { from_rfc3339: 'not-a-date', until_rfc3339: future(2, 9),
          duration_min: 30 }),
    ).rejects.toThrow(/from_rfc3339 parse/);
  });
});

async function prep(playwright: Playwright): Promise<BaseSeed> {
  // permissive policy: all weekdays + no lead time → so today/tomorrow
  // both yield slots regardless of current weekday.
  return seedOwnerGCalConnected(playwright, {
    allowed_weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
    min_lead_hours: 0,
  });
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
