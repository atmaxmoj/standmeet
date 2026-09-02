// chat-book-conflict-busy.spec.ts — every preferred_time the visitor proposes collides with
// a window that's already busy on the owner's calendar. The booker's FreeBusy filters all
// of them out → BookConflictAllBusy, no event written.
// This is booking's core branch (this spec file used to be empty, i.e. uncovered).

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { getMockEvents, setMockBusy } from '@/fixtures/gcal';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall, sendAndDrain } from '@/fixtures/mock-llm-script';

test.describe('chat · calendar.book conflict: all preferred times busy', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('the only proposed slot overlaps a busy window → no event written',
    async () => {
      const slot = future(7, 14); // policy-valid (a weekday, far enough ahead), but marked busy below
      await setMockBusy(seed.request, [{
        start: future(7, 13, 30), end: future(7, 15),
      }]);
      const tag = await scriptMockToolCall(seed.request, {
        name: 'calendar_book',
        args: { topic: 'Backend deep-dive', duration_min: 30, preferred_times: [slot] },
      });
      await sendAndDrain(seed.request, seed.visitor, `book me next week at 2pm${tag}`);
      // all busy → the booker does not insert. No new event on the mock calendar.
      const events = await getMockEvents(seed.request);
      expect(events).toHaveLength(0);
    });
});

async function prep(playwright: Playwright): Promise<CodedSeed> {
  return seedCodeVisitorOnConnectedOwner(playwright, {
    granted_skills: ['calendar.book'],
    policy: { min_lead_days: 1 },
  });
}

function future(days: number, hour: number, min = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, min, 0, 0);
  return d.toISOString();
}
