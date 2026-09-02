// tool-calendar-cancel-booking.spec.ts -- Phase E-14c MCP parity:
// the owner calls calendar.cancel_booking in Claude Code to cancel a meeting. Flow:
//   1. a visitor books via chat, calling calendar_book
//   2. booker's own bookings.list tool fetches the booking_id (the admin REST route is retired)
//   3. owner MCP calendar.cancel_booking(booking_id)
//   4. verify mock gcal /__mock/gcal/deleted_events received that event_id
//   5. verify bookings.list no longer contains this booking

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

      // 2. Get the booking_id -- via booker's own bookings_list tool.
      // The host's admin REST route is retired: the booked meeting is booker's data, so the listing should come from booker too.
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
      // F-B-7 -- a real person is sitting in this meeting (the seeded visitor has
      // rachel@example.com). The contract has this written down as a comment:
      // `contract/contract.go:27-28` says DeleteEvent "notifies attendees of the
      // cancellation (sendUpdates=all)" when attendeeEmail is non-empty. Deleting the event
      // without notifying is the same as letting them show up on time for a meeting that no
      // longer exists -- and before this line, "deleted" and "deleted and notified" read
      // identically to the assertions.
      const gone = deletedBody.events.find((e) => e.event_id === insertedEventID);
      expect(gone?.send_updates,
        'the guest on this meeting was told it was cancelled').toBe('all');

      // 5. it's no longer in the list
      const after = await callTool<{ bookings: AdminBooking[] }>(
        seed.request, apiToken, sid, 'bookings.list', {});
      expect(after.bookings.find((b) => b.id === booking.id)).toBeUndefined();
    });

  // Not found -> booker's own error convention {ok:false,error,detail} (all of its tools use
  // this), not an MCP isError -- once cancellation moved into the sandbox, it uses the same
  // convention as booker's other tools.
  // Does not distinguish "doesn't exist" from "not yours": neither should leak existence.
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
