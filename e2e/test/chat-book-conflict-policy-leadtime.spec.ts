// chat-book-conflict-policy-leadtime.spec.ts —— visitor proposes a time
// that's sooner than owner's min_lead_days allows. Backend returns
// `conflict: policy, reasons: [lead_time_too_short]`; no event written.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { getMockEvents } from '@/fixtures/gcal';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall, sendAndDrain } from '@/fixtures/mock-llm-script';

test.describe('chat · calendar.book policy: lead_time_too_short', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('preferred time only 1h away (< 1-day lead) → reasons include lead_time_too_short',
    async () => {
      const t = inOneHour();
      const tag = await scriptMockToolCall(seed.request, {
        name: 'calendar_book',
        args: {
          topic: 'Quick sync',
          duration_min: 30,
          preferred_times: [t],
        },
      });
      await sendAndDrain(seed.request, seed.visitor, `Can we chat in an hour?${tag}`);
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

function inOneHour(): string {
  const d = new Date();
  d.setUTCHours(d.getUTCHours() + 1);
  return d.toISOString();
}
