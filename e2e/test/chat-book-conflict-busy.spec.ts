// chat-book-conflict-busy.spec.ts —— 访客提的所有 preferred_times 都撞上 owner 日历
// 已 busy 的窗口。booker FreeBusy 全过滤掉 → BookConflictAllBusy,不写事件。
// 这是 booking 的核心分支(之前这个 spec 文件是空的,等于没盖)。

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
      const slot = future(7, 14); // policy-valid(工作日 + 够提前),但下面标成 busy
      await setMockBusy(seed.request, [{
        start: future(7, 13, 30), end: future(7, 15),
      }]);
      const tag = await scriptMockToolCall(seed.request, {
        name: 'calendar_book',
        args: { topic: 'Backend deep-dive', duration_min: 30, preferred_times: [slot] },
      });
      await sendAndDrain(seed.request, seed.visitor, `book me next week at 2pm${tag}`);
      // 全 busy → booker 不 insert。mock 日历无新事件。
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
