// chat-book-session-email-default.spec.ts —— #121: the email a visitor enters on the way
// in gets stored in the session profile; even if calendar_book's tool arguments don't carry
// visitor_email, the booker falls back to the session's email → Google still sends the
// invite to the visitor.
//
// Conversely proves: a session with no email filled in doesn't get a recipient invented out
// of thin air by the booker.

import { test, expect } from '@/fixtures/test';

import { getMockEvents, resetMockGCal } from '@/fixtures/gcal';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall, sendAndDrain } from '@/fixtures/mock-llm-script';
import { issueSession } from '@/fixtures/visitor';

const SESSION_EMAIL = 'dana.session@example.com';

test.describe('chat · calendar.book defaults visitor_email from session profile (#121)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('book with no visitor_email arg → Google invite uses the session email',
    async () => {
      // Enters with an email (stored in the session profile).
      const sess = await issueSession(seed.request, {
        handle: OWNER.handle, code: seed.code.code,
        visitor_name: 'Dana', visitor_email: SESSION_EMAIL,
      });
      // calendar_book's tool arguments **deliberately omit** visitor_email — simulating the AI not having asked.
      const tag = await scriptMockToolCall(seed.request, {
        name: 'calendar_book',
        args: { topic: 'Intro call', duration_min: 30, preferred_times: [future(7, 14)] },
      });
      await sendAndDrain(seed.request, sess, `book me a 30-min chat next week${tag}`);

      const events = await getMockEvents(seed.request);
      expect(events).toHaveLength(1);
      // The booker falls back to the session profile's email as the attendee.
      expect(events[0]!.attendees ?? []).toEqual(
        expect.arrayContaining([expect.objectContaining({ email: SESSION_EMAIL })]),
      );
      // F-B-7 —— this spec's header claims "Google still sends the invite to the visitor,"
      // but up to this line, all it can actually prove is "the visitor was added to the
      // guest list." Whether Google sends a notification is a separate switch:
      // `events.insert` only notifies attendees when `sendUpdates=all` is set, and silently
      // adds them otherwise. The list can be right, the notification never sent, and the
      // assertion above would still go green — it can't see that it only verified half
      // ([[verifier-can-lie-about-its-own-coverage]]).
      expect(events[0]!.send_updates,
        'the provider was asked to notify the guest, not just to list them').toBe('all');
    });

  test('no session email + no arg → no attendee invented',
    async () => {
      await resetMockGCal(seed.request);
      // This session carries no email.
      const sess = await issueSession(seed.request, {
        handle: OWNER.handle, code: seed.code.code, visitor_name: 'Eli',
      });
      const tag = await scriptMockToolCall(seed.request, {
        name: 'calendar_book',
        args: { topic: 'Intro call', duration_min: 30, preferred_times: [future(8, 15)] },
      });
      await sendAndDrain(seed.request, sess, `book me a 30-min chat${tag}`);

      const events = await getMockEvents(seed.request);
      expect(events).toHaveLength(1);
      expect(events[0]!.attendees ?? []).toHaveLength(0);
    });
});

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
