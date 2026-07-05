// visitor-reschedule-booking.spec.ts —— ④: 访客把**自己本对话**那笔预约改到一个新的
// owner-available 时间。
//
// 原子性是重点(先订新、再删旧):
//   - happy: 约 T1 → 改到 T2(空闲)→ 恰 1 个 event、在 T2,旧 T1 那条 event 消失(旧 slot 释放)。
//   - 原子性: T2 已被别人占 → 改 T1→T2 失败(conflict),**原 T1 预约完好无损**(没把访客弄丢)。
//   - 隔离(同 #123): Mallory(同码另一 member)改不了 Dana 的预约 —— resolveConvBooking 的
//     conversation 归属门挡下,Dana 的 event 仍在。
//
// 全程 API-driven: booking / reschedule 都走 tool-dispatch(卡上 mcp-ui:tool 落到后端的同一条路),
// 可观察副作用 = mock GCal 的 event(真跑了没)。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { getMockEvents, resetMockGCal, setMockBusy } from '@/fixtures/gcal';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const TOPIC = 'Intro call about backend work';

interface ToolBook { ok?: boolean; event_id?: string; conflict?: string }

test.describe('visitor · reschedule own booking + atomicity + isolation (④)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'], max_bookings: 9,
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('happy: reschedule to a free slot → event moves, old slot freed', async () => {
    await resetMockGCal(seed.request);
    const alice = await session(seed, 'RA-Alice', 'ra-alice@example.com');
    const booked = await book(seed.request, alice, futureWeekday(7, 10));
    expect(booked.ok, 'initial booking succeeds').toBe(true);

    const target = futureWeekday(7, 15);
    const moved = await reschedule(seed.request, alice, booked.event_id!, target);
    expect(moved.ok, 'reschedule into a free slot succeeds').toBe(true);

    const events = await getMockEvents(seed.request);
    expect(events, 'exactly one event after reschedule (old freed, new made)').toHaveLength(1);
    expect(events[0]!.event_id, 'it is a new event, not the old one').not.toBe(booked.event_id);
    expect(events[0]!.start.dateTime, 'the surviving event sits at the new time').toBe(target);
  });

  test('atomicity: reschedule into an occupied slot fails, original booking untouched', async () => {
    await resetMockGCal(seed.request);
    const bob = await session(seed, 'RA-Bob', 'ra-bob@example.com');

    const t1 = futureWeekday(8, 10);
    const t2 = futureWeekday(8, 15);
    // Mark t2 busy in the owner's FreeBusy fixture (the mock's FreeBusy is seeded, not derived
    // from inserted events) so the rebook into t2 genuinely conflicts.
    await setMockBusy(seed.request, [{ start: t2, end: plusMinutes(t2, 30) }]);

    const bobBooking = await book(seed.request, bob, t1);
    expect(bobBooking.ok, 'bob books t1 (free)').toBe(true);

    // Bob tries to move t1 → t2 (busy). Book-new-first means the rebook fails and t1 survives.
    const moved = await reschedule(seed.request, bob, bobBooking.event_id!, t2);
    expect(moved.ok, 'reschedule into a busy slot is rejected').toBe(false);

    const events = await getMockEvents(seed.request);
    expect(events.find((e) => e.event_id === bobBooking.event_id),
      'bob\'s original t1 booking is untouched (not lost)').toBeDefined();
    expect(events, 'no phantom event created (rebook failed, old kept)').toHaveLength(1);
  });

  test('isolation: another member cannot reschedule someone else\'s booking', async () => {
    await resetMockGCal(seed.request);
    const dana = await session(seed, 'RA-Dana', 'ra-dana@example.com');
    const danaBooking = await book(seed.request, dana, futureWeekday(9, 10));

    const mallory = await session(seed, 'RA-Mallory', 'ra-mallory@example.com');
    const moved = await reschedule(seed.request, mallory, danaBooking.event_id!, futureWeekday(9, 15));
    expect(moved.ok, 'mallory cannot move dana\'s booking').toBe(false);

    const events = await getMockEvents(seed.request);
    expect(events.find((e) => e.event_id === danaBooking.event_id),
      'dana\'s booking is untouched by mallory').toBeDefined();
  });
});

function session(seed: CodedSeed, name: string, email: string): Promise<VisitorSession> {
  return issueSession(seed.request, {
    handle: OWNER.handle, mode: 'code', code: seed.code.code,
    visitor_name: name, visitor_email: email,
  });
}

async function book(
  request: APIRequestContext, s: VisitorSession, time: string,
): Promise<ToolBook> {
  return dispatch(request, s, 'calendar_book',
    { topic: TOPIC, duration_min: 30, preferred_times: [time] });
}

async function reschedule(
  request: APIRequestContext, s: VisitorSession, eventID: string, time: string,
): Promise<ToolBook> {
  return dispatch(request, s, 'calendar_reschedule',
    { event_id: eventID, duration_min: 30, preferred_times: [time] });
}

async function dispatch(
  request: APIRequestContext, s: VisitorSession, tool: string, data: unknown,
): Promise<ToolBook> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${s.conversation_id}/tools/${tool}`,
    { headers: { Authorization: `Bearer ${s.session_token}` }, data },
  );
  const body = await res.json() as { result?: ToolBook };
  return body.result ?? {};
}

// futureWeekday —— 从今天 + minDays 起,顺延到工作日(Mon–Fri),定在 hour:00 UTC。避开
// 周末的 booking policy(weekday-only #125),让 slot 稳定可约。
function futureWeekday(minDays: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + minDays);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

function plusMinutes(rfc3339: string, minutes: number): string {
  return new Date(new Date(rfc3339).getTime() + minutes * 60_000).toISOString();
}
