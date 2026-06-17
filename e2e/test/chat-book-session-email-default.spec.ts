// chat-book-session-email-default.spec.ts —— #121: 访客进入时填的 email 存进
// session profile;calendar_book 即使工具参数里没带 visitor_email,booker 也用
// session 的 email 兜底 → Google 仍把 invite 发给访客。
//
// 反过来证明:没填 email 的 session,booker 不会凭空塞收件人。

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
      // 进入时带 email(存进 session profile)。
      const sess = await issueSession(seed.request, {
        handle: OWNER.handle, code: seed.code.code,
        visitor_name: 'Dana', visitor_email: SESSION_EMAIL,
      });
      // calendar_book 工具参数**故意不带** visitor_email —— 模拟 AI 没问到。
      await scriptMockToolCall(seed.request, {
        name: 'calendar_book',
        args: { topic: 'Intro call', duration_min: 30, preferred_times: [future(7, 14)] },
      });
      await sendAndDrain(seed.request, sess, 'book me a 30-min chat next week');

      const events = await getMockEvents(seed.request);
      expect(events).toHaveLength(1);
      // booker 用 session profile 的 email 兜底当 attendee。
      expect(events[0]!.attendees ?? []).toEqual(
        expect.arrayContaining([expect.objectContaining({ email: SESSION_EMAIL })]),
      );
    });

  test('no session email + no arg → no attendee invented',
    async () => {
      await resetMockGCal(seed.request);
      // 这个 session 没带 email。
      const sess = await issueSession(seed.request, {
        handle: OWNER.handle, code: seed.code.code, visitor_name: 'Eli',
      });
      await scriptMockToolCall(seed.request, {
        name: 'calendar_book',
        args: { topic: 'Intro call', duration_min: 30, preferred_times: [future(8, 15)] },
      });
      await sendAndDrain(seed.request, sess, 'book me a 30-min chat');

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
