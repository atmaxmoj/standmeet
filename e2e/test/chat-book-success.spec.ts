// chat-book-success.spec.ts —— code visitor → AI calls calendar.book →
// FreeBusy clear → Events.insert succeeds → mock GCal has the event,
// chat reply confirms it.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { getMockEvents } from '@/fixtures/gcal';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall, sendAndDrain } from '@/fixtures/mock-llm-script';

test.describe('chat · calendar.book happy path', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('AI books a meeting; mock GCal records the event; reply confirms',
    async () => {
      const start = futureSlot(7, 14);   // 7 days out, 14:00 local
      await scriptMockToolCall(seed.request, {
        name: 'calendar.book',
        args: {
          topic: 'Recruiter chat about retrieval-quality role',
          duration_min: 30,
          preferred_times: [start],
          visitor_email: 'rachel@example.com',
        },
      });
      await sendAndDrain(seed.request, seed.visitor, 'Can we book a 30-min chat next week?');
      const events = await getMockEvents(seed.request);
      expect(events).toHaveLength(1);
      expect(events[0]!.summary).toContain('Recruiter Rachel');
      expect(events[0]!.summary).toContain('Recruiter chat about retrieval-quality role');
      expect(events[0]!.attendees ?? []).toEqual(
        expect.arrayContaining([expect.objectContaining({ email: 'rachel@example.com' })]),
      );
      expect(events[0]!.start.dateTime).toBe(start);
    });
});

async function prep(playwright: Playwright): Promise<CodedSeed> {
  return seedCodeVisitorOnConnectedOwner(playwright, {
    granted_skills: ['calendar.book'],
  });
}

function futureSlot(daysAhead: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
