// booking-owner-tools-not-for-visitors.spec.ts —— the owner's booking tools (list every booking,
// cancel any booking by id) are the owner's, not a visitor's.
//
// Found 2026-10-02 while planning per-fiber storage: calendar.book's manifest lists `bookings_list`
// and `calendar_cancel_booking` under visitor_tools as well as owner_tools, and the booker answers
// them for any session of the owner. A visitor granted booking could then read every other
// visitor's name and email, and cancel their meetings.
//
// Black box: visitor A books through the chat; visitor B (a second name on the same code) opens a
// session. B keeps the tools a visitor needs (calendar_book), and cannot list or cancel A's booking.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { runToolAndRead, sessionToolNames } from '@/fixtures/blocks';
import { getMockEvents } from '@/fixtures/gcal';
import { seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed } from '@/fixtures/gcal-setup';
import { scriptMockToolCall, sendAndDrain } from '@/fixtures/mock-llm-script';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

test.describe.serial('booking · the owner tools stay with the owner', () => {
  let seed: CodedSeed;
  let other: VisitorSession;

  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(120_000);
    seed = await prep(playwright);
    const tag = await scriptMockToolCall(seed.request, {
      name: 'calendar_book',
      args: { topic: 'Visitor A chat', duration_min: 30, preferred_times: [futureSlot(7, 14)] },
    });
    await sendAndDrain(seed.request, seed.visitor, `Book 30 minutes next week?${tag}`);
    expect(await getMockEvents(seed.request), 'visitor A booked').toHaveLength(1);
    other = await issueSession(seed.request, {
      handle: seed.visitor.owner_handle, mode: 'code', code: seed.code.code,
      visitor_name: 'Visitor B', visitor_email: 'b@example.com',
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('a visitor keeps calendar_book but has no owner booking tools', async () => {
    const tools = await sessionToolNames(seed.request, other.session_token);
    expect(tools, 'a granted visitor can still book').toContain('calendar_book');
    expect(tools, 'listing every booking is an owner tool').not.toContain('bookings_list');
    expect(tools, 'cancelling any booking by id is an owner tool').not.toContain('calendar_cancel_booking');
  });

  test('a visitor cannot read another visitor\'s booking through the booker', async () => {
    const leaked = await runToolAndRead(seed.request, other.session_token, 'bookings_list', {})
      .then((r) => JSON.stringify(r))
      .catch(() => '');
    expect(leaked, 'visitor A\'s email never reaches visitor B').not.toContain('rachel@example.com');
  });
});

async function prep(playwright: Playwright): Promise<CodedSeed> {
  return seedCodeVisitorOnConnectedOwner(playwright, { granted_skills: ['calendar.book'] });
}

function futureSlot(daysAhead: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
