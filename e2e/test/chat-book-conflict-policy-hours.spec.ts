// chat-book-conflict-policy-hours.spec.ts —— visitor proposes a slot
// outside the owner's working_hours window. Reason must include
// `outside_working_hours`; no event written.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { getMockEvents } from '@/fixtures/gcal';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall, sendAndDrain } from '@/fixtures/mock-llm-script';

test.describe('chat · calendar.book policy: outside_working_hours', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('23:00 slot when working hours are 09-18 → outside_working_hours',
    async () => {
      const lateNight = future(7, 23);
      await scriptMockToolCall(seed.request, {
        name: 'calendar_book',
        args: {
          topic: 'Late chat',
          duration_min: 30,
          preferred_times: [lateNight],
        },
      });
      await sendAndDrain(seed.request, seed.visitor, '11pm next Wed?');
      const events = await getMockEvents(seed.request);
      expect(events).toHaveLength(0);
    });
});

async function prep(playwright: Playwright): Promise<CodedSeed> {
  return seedCodeVisitorOnConnectedOwner(playwright, {
    granted_skills: ['calendar.book'],
    policy: {
      working_hours_start: '09:00',
      working_hours_end: '18:00',
    },
  });
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
