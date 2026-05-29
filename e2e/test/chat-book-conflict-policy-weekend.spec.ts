// chat-book-conflict-policy-weekend.spec.ts —— visitor proposes a
// Saturday slot but owner's allowed_weekdays excludes weekends. Reasons
// must include `day_not_allowed`; no event written.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { getMockEvents } from '@/fixtures/gcal';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall, sendAndDrain } from '@/fixtures/mock-llm-script';

test.describe('chat · calendar.book policy: day_not_allowed', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('Saturday slot when policy is Mon-Fri → day_not_allowed', async () => {
    const sat = nextSaturday();
    await scriptMockToolCall(seed.request, {
      name: 'calendar.book',
      args: {
        topic: 'Sat coffee',
        duration_min: 45,
        preferred_times: [sat],
      },
    });
    await sendAndDrain(seed.request, seed.visitor, 'How about Saturday?');
    const events = await getMockEvents(seed.request);
    expect(events).toHaveLength(0);
  });
});

async function prep(playwright: Playwright): Promise<CodedSeed> {
  return seedCodeVisitorOnConnectedOwner(playwright, {
    granted_skills: ['calendar.book'],
    policy: { allowed_weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'] },
  });
}

function nextSaturday(): string {
  const d = new Date();
  const today = d.getUTCDay();                  // 0 = Sun, 6 = Sat
  const delta = (6 - today + 7) % 7 || 7;       // strictly future Saturday
  d.setUTCDate(d.getUTCDate() + delta);
  d.setUTCHours(14, 0, 0, 0);
  return d.toISOString();
}
