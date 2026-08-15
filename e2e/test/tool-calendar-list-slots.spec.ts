// tool-calendar-list-slots.spec.ts —— Phase E-14c MCP parity:
// owner 在 Claude Code 调 calendar.list_slots 找可约时间。policy 拦掉
// 周末 / lead-time 内的；FreeBusy 拦掉跟现有 busy 重叠的。

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

  // 这一条替掉了原来那条「named IANA timezone 仍然出得来时段」—— 它只问「还有时段吗」，
  // **没有人问过那个时区到底有没有被用上**，而 F-B-5 正长在这个洞里：prod 上
  // `profile_timezone` 是空串，工作时间于是在 UTC 上判，owner 的 09:00–18:00 变成访客眼里的
  // 凌晨 05:18，而当时每一条相关用例都是绿的。
  //
  // 判据要能分辨「用了这个时区」和「用了 UTC」，所以取一个**两边答案相反**的窗口：
  // 09:00–13:00 UTC 在 UTC 眼里全在工作时间内，在多伦多眼里是 05:00–09:00（上班前）。
  //
  // 旧那条的**独有职责也接了过来**：后端走 `time.LoadLocation(owner.profile_timezone)`，
  // 静态 CGO_ENABLED=0 的二进制若没打进 `time/tzdata`，这一步会报错、所有候选被否掉、
  // 时段数归零 —— 下面那个**正对照**（下午必须有时段）就是那种情况下最先红的一条。
  test('working hours are read in the owner’s zone — a UTC-morning window is before work',
    async () => {
      await setBookingPolicy(seed.request, freshCsrf, { timezone: 'America/Toronto' });

      // 正对照先立起来：同一天、同样的政策，下午那段（14:00–20:00 UTC = 10:00–16:00 EDT）
      // 必须有时段。没有它，下面那个 0 可能只是窗口不对/提前期没过。
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

// countSlots —— 同一天（+3 天，清过提前期）的一段 UTC 窗口里有几个时段。
// 两次问答只差窗口，所以「有」和「没有」的差别只可能来自政策，而政策里唯一在动的是时区。
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
