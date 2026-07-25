// chat-book-quota-exhausted.spec.ts —— code's max_bookings=2. After 2
// successful bookings, the tool DISAPPEARS from the session's tool spec
// (consistent with all other gates — never "visible but errors out").

import { test } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { expectCalendarBookExposed } from '@/fixtures/agent-skills-grant';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall, sendAndDrain } from '@/fixtures/mock-llm-script';

test.describe('chat · calendar.book quota disappears tool after limit', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('after 2 bookings on a max_bookings=2 code, tool no longer in spec',
    async () => {
      // 1st booking
      await bookOnce(seed, future(7, 14));
      await expectCalendarBookExposed(seed.request, seed.visitor.session_token, true);
      // 2nd booking
      await bookOnce(seed, future(8, 15));
      // After the quota is spent, tool is absent.
      await expectCalendarBookExposed(seed.request, seed.visitor.session_token, false);
    });
});

async function bookOnce(seed: CodedSeed, start: string): Promise<void> {
  const tag = await scriptMockToolCall(seed.request, {
    name: 'calendar_book',
    args: {
      topic: 'Quota check', duration_min: 30, preferred_times: [start],
    },
  });
  await sendAndDrain(seed.request, seed.visitor, `Book me a slot${tag}`);
}

async function prep(playwright: Playwright): Promise<CodedSeed> {
  return seedCodeVisitorOnConnectedOwner(playwright, {
    granted_skills: ['calendar.book'],
    max_bookings: 2,
  });
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  // booking policy default = mon–fri; skip weekends so the slot passes policy
  // regardless of what weekday "now" lands on (avoids date-dependent flake).
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
