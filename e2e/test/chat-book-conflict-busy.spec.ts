// chat-book-conflict-busy.spec.ts —— owner is busy at every preferred
// slot. Backend returns `conflict: all_busy` with busy_windows; no event
// is created on the mock GCal.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { getMockEvents, setMockBusy } from '@/fixtures/gcal';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall, sendAndDrain } from '@/fixtures/mock-llm-script';

test.describe('chat · calendar.book all_busy conflict', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('owner busy at both preferred times → no event, AI mentions busy', async () => {
    const t1 = future(7, 14);
    const t2 = future(7, 16);
    await setMockBusy(seed.request, [
      { start: t1, end: future(7, 15) },
      { start: t2, end: future(7, 17) },
    ]);
    await scriptMockToolCall(seed.request, {
      name: 'calendar.book',
      args: {
        topic: 'Recruiter chat',
        duration_min: 30,
        preferred_times: [t1, t2],
      },
    });
    await sendAndDrain(seed.request, seed.visitor, 'Book a 30-min next week');
    const events = await getMockEvents(seed.request);
    expect(events).toHaveLength(0);
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
