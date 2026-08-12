// tool-calendar-cancel-booking.spec.ts —— Phase E-14c MCP parity:
// owner 在 Claude Code 调 calendar.cancel_booking 撤会。流程:
//   1. visitor 通过 chat 调 calendar_book 落一条 booking
//   2. booker 的 bookings.list 工具拿 booking_id(admin REST 已退役)
//   3. owner MCP calendar.cancel_booking(booking_id)
//   4. 验 mock gcal /__mock/gcal/deleted_events 收到该 event_id
//   5. 验 bookings.list 不再含该 booking

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { getMockEvents } from '@/fixtures/gcal';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall, sendAndDrain } from '@/fixtures/mock-llm-script';
import { createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { callTool, initMCP } from '@/fixtures/mcp';

const MOCK = process.env['MOCK_BASE_URL'] ?? 'http://localhost:9000';

interface AdminBooking { id: string; google_event_id: string }
interface CancelResp {
  booking_id: string;
  google_event_id: string;
  cancelled: boolean;
}

test.describe('Phase E-14c calendar.cancel_booking via MCP', () => {
  let seed: CodedSeed;
  let sid: string;
  let apiToken: string;

  test.beforeAll(async ({ playwright }) => {
    seed = await prep(playwright);
    const { csrf } = await loginAPI(seed.request, OWNER.email, OWNER.password);
    apiToken = await createAPIToken(seed.request, csrf, 'cancel-booking-token');
    sid = await initMCP(seed.request, apiToken);
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('cancel_booking: book → cancel → mock event deleted, row gone',
    async () => {
      // 1. visitor books via chat
      const t1 = future(7, 14);
      const tag = await scriptMockToolCall(seed.request, {
        name: 'calendar_book',
        args: { topic: 'will be cancelled', duration_min: 30,
          preferred_times: [t1] },
      });
      await sendAndDrain(seed.request, seed.visitor, `Book me${tag}`);
      const created = await getMockEvents(seed.request);
      expect(created.length).toBe(1);
      const insertedEventID = created[0]!.event_id;

      // 2. 拿 booking_id —— 走 booker 自己的 bookings_list 工具。
      // host 那条 admin REST 路由已退役:约成的会是 booker 的数据,列表也该由它出。
      const listed = await callTool<{ bookings: AdminBooking[] }>(
        seed.request, apiToken, sid, 'bookings.list', {});
      const booking = listed.bookings.find((b) => b.google_event_id === insertedEventID);
      expect(booking).toBeDefined();
      if (!booking) throw new Error('booking not found via bookings.list');

      // 3. owner MCP cancel
      const resp = await callTool<CancelResp>(
        seed.request, apiToken, sid, 'calendar.cancel_booking',
        { booking_id: booking.id },
      );
      expect(resp.cancelled).toBe(true);
      expect(resp.google_event_id).toBe(insertedEventID);

      // 4. mock recorded the delete
      const delRes = await seed.request.get(`${MOCK}/__mock/gcal/deleted_events`);
      const deletedBody = await delRes.json() as {
        events: Array<{ event_id: string; send_updates?: string }>;
      };
      expect(deletedBody.events.map((e) => e.event_id))
        .toContain(insertedEventID);
      // F-B-7 —— 这条会上坐着一个真人(seed 的访客带 rachel@example.com)。契约把这件事
      // 写成了注释：`contract/contract.go:27-28` 说 DeleteEvent 在 attendeeEmail 非空时
      // 「通知与会者取消(sendUpdates=all)」。删掉事件而不通知，等于让他按时到场开一个
      // 已经不存在的会 —— 而在这一行之前，「删了」和「删了且通知了」在断言上一模一样。
      const gone = deletedBody.events.find((e) => e.event_id === insertedEventID);
      expect(gone?.send_updates,
        'the guest on this meeting was told it was cancelled').toBe('all');

      // 5. 列表里没有它了
      const after = await callTool<{ bookings: AdminBooking[] }>(
        seed.request, apiToken, sid, 'bookings.list', {});
      expect(after.bookings.find((b) => b.id === booking.id)).toBeUndefined();
    });

  // 找不到 → booker 自己的错误约定 {ok:false,error,detail}(它全部工具都这样),
  // 不是 MCP isError —— 取消搬进沙箱之后,它跟 booker 其余工具用同一套。
  // 不区分"不存在"和"不是你的":两者都不该泄露存在性。
  test('cancel_booking on unknown booking_id reports not_found', async () => {
    const resp = await callTool<{ ok: boolean; error: string; detail: string }>(
      seed.request, apiToken, sid, 'calendar.cancel_booking',
      { booking_id: '00000000-0000-0000-0000-000000000000' });
    expect(resp.ok).toBe(false);
    expect(resp.error).toBe('not_found');
    expect(resp.detail).toMatch(/booking not found/);
  });
});

async function prep(playwright: Playwright): Promise<CodedSeed> {
  return seedCodeVisitorOnConnectedOwner(playwright, {
    granted_skills: ['calendar.book'],
  });
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
