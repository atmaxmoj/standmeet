// visitor-chat-slots-readonly.spec.ts -- F-B-10: **under a read-only grant, the slots
// card must not be an entry point into booking.**
//
// This defect surfaced while driving F-B-8's item (5). Once the grant narrowed to
// `calendar.readonly`, `calendar_book` genuinely dropped out of the tool table (38->34,
// confirmed by prod logs), but the visitor's screen barely changed: the card still laid
// out a row of clickable chips, and the AI still said *"Tap the 9:00 AM slot on the card
// and it'll lock in the booking"*. The first fix (removing the booking instructions from
// the capability-level instructions) **wasn't enough** -- driving it again produced the
// same line. Where the promise actually lands is **the card itself**: the card is
// attached to `calendar_list_slots`, and that tool is present under a read-only grant;
// clicking any chip posts a message saying "book the ... slot", and under this grant that
// message can never actually reach a booking.
//
// This field's fact is now answered by the host (`connector.invoke can_perform
// events.insert`), the plugin puts it into the result as `can_book`, and the card decides
// whether to offer the entry point based on that -- the same rule the booked card follows
// when deciding whether to render the confirmation-email widget based on `can_email`:
// **an action you can't do gets no entry point**.
//
// Both assertions are required. Asserting only "there's no clickable chip" would also
// pass if the card didn't render at all -- and that would take away something the grant
// **can** do (see when the owner is free), which is a different defect.

import { test, expect } from '@/fixtures/test';

import { GCAL_SCOPE_READ } from '@/fixtures/gcal';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';

test.describe('F-B-10 · a read-only grant makes the slot card read-only', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'], scopes: [GCAL_SCOPE_READ],
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('the times still show, and none of them is a booking button',
    async ({ browser, playwright }) => {
      test.setTimeout(120_000);
      const req = await playwright.request.newContext();
      const tag = await scriptMockToolCall(req, {
        name: 'calendar_list_slots',
        args: {
          from_rfc3339: future(3, 13), until_rfc3339: future(5, 23),
          duration_min: 30, step_min: 60,
        },
      });
      await req.dispose();

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, seed.code.code);
      await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
      const input = page.getByTestId('chat-input-field');
      await input.fill(`what afternoons are open next week?${tag}`);
      await input.press('Enter');

      await expect(page.getByTestId('mcp-app-card-calendar_list_slots'),
        'the card still renders — reading free/busy is something this grant CAN do')
        .toBeVisible({ timeout: 20_000 });
      const frame = page.frameLocator('[data-testid="mcp-app-card-calendar_list_slots"]');

      // First proves the card actually rendered (otherwise "there's no clickable chip"
      // below would be a vacuous statement that's always true).
      await expect(frame.getByTestId('tool-card-slot-readonly').first(),
        'the owner\'s free times are shown, as plain times')
        .toBeVisible({ timeout: 10_000 });
      await expect(frame.getByTestId('slots-readonly-note'),
        'and the card says why there is nothing to tap')
        .toBeVisible();

      await expect(frame.getByTestId('tool-card-slot'),
        'no chip is a booking button: this grant cannot write an event, and a tap that '
        + 'leads nowhere is the defect')
        .toHaveCount(0);

      await ctx.close();
    });
});

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
