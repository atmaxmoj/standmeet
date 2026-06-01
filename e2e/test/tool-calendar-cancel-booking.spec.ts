// tool-calendar-cancel-booking.spec.ts —— Phase E-14c MCP parity:
// owner 在 Claude Code 调 calendar.cancel_booking 撤会。流程:
//   1. visitor 通过 chat 调 calendar_book 落一条 booking
//   2. admin REST list bookings 拿 booking_id
//   3. owner MCP calendar.cancel_booking(booking_id)
//   4. 验 mock gcal /__mock/gcal/deleted_events 收到该 event_id
//   5. 验 admin REST list bookings 不再含该 booking

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { getMockEvents } from '@/fixtures/gcal';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall, sendAndDrain } from '@/fixtures/mock-llm-script';
import { createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { callTool, initMCP } from '@/fixtures/mcp';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
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
      await scriptMockToolCall(seed.request, {
        name: 'calendar_book',
        args: { topic: 'will be cancelled', duration_min: 30,
          preferred_times: [t1] },
      });
      await sendAndDrain(seed.request, seed.visitor, 'Book me');
      const created = await getMockEvents(seed.request);
      expect(created.length).toBe(1);
      const insertedEventID = created[0]!.event_id;

      // 2. find booking_id via admin REST
      const adminList = await seed.request.get(
        `${BACKEND}/api/admin/bookings/`,
      );
      expect(adminList.status()).toBe(200);
      const rows = await adminList.json() as AdminBooking[];
      const booking = rows.find((b) => b.google_event_id === insertedEventID);
      expect(booking).toBeDefined();
      if (!booking) throw new Error('booking not found via admin REST');

      // 3. owner MCP cancel
      const resp = await callTool<CancelResp>(
        seed.request, apiToken, sid, 'calendar.cancel_booking',
        { booking_id: booking.id },
      );
      expect(resp.cancelled).toBe(true);
      expect(resp.google_event_id).toBe(insertedEventID);

      // 4. mock recorded the delete
      const delRes = await seed.request.get(`${MOCK}/__mock/gcal/deleted_events`);
      const deletedBody = await delRes.json() as { events: Array<{ event_id: string }> };
      expect(deletedBody.events.map((e) => e.event_id))
        .toContain(insertedEventID);

      // 5. row gone from admin list
      const afterList = await seed.request.get(
        `${BACKEND}/api/admin/bookings/`,
      );
      const afterRows = await afterList.json() as AdminBooking[];
      expect(afterRows.find((b) => b.id === booking.id)).toBeUndefined();
    });

  test('cancel_booking on unknown booking_id returns isError', async () => {
    await expect(
      callTool(seed.request, apiToken, sid, 'calendar.cancel_booking',
        { booking_id: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toThrow(/booking not found/);
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
