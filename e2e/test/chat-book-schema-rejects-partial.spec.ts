// chat-book-schema-rejects-partial.spec.ts —— AI tries to call
// calendar.book missing a required field (duration_min). Backend rejects
// the tool call via JSON schema; AI sees a tool_result error and no
// event is recorded.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { getMockEvents } from '@/fixtures/gcal';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall, sendAndDrain } from '@/fixtures/mock-llm-script';

test.describe('chat · calendar.book schema rejects partial args', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('missing duration_min → tool_result is error; mock has no event', async () => {
    const tag = await scriptMockToolCall(seed.request, {
      name: 'calendar_book',
      args: {
        topic: 'Missing duration',
        preferred_times: [future(7, 14)],
        // duration_min intentionally omitted
      },
    });
    await sendAndDrain(seed.request, seed.visitor, `Book me${tag}`);
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
