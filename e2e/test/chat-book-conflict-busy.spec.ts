// chat-book-conflict-busy.spec.ts —— owner is busy at every preferred
// slot. Backend returns `conflict: all_busy` with busy_windows; no event
// is created on the mock GCal.
//
// UI-driven (G-1)：visitor 在浏览器里跟 chat dock 真问 + 真按 Enter，
// 看到 tool-throbber-calendar_book 出现 (证明 visitor pi-agent-core 真调到
// calendar.book tool)；turn 完成后浏览器看到 answer 文本 + mock gcal 没有
// 新 event。D-5 加的 throbber UI 之前只接在 ConversationDeck (no-code hero)，
// 这次顺手补到 ChatRoom (code-mode visitor)。

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { getMockEvents, setMockBusy } from '@/fixtures/gcal';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';

test.describe('chat · calendar.book all_busy conflict', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('owner busy at both preferred times → throbber visible, no event, AI replies',
    async ({ browser }) => {
      const t1 = future(7, 14);
      const t2 = future(7, 16);
      await setMockBusy(seed.request, [
        { start: t1, end: future(7, 15) },
        { start: t2, end: future(7, 17) },
      ]);
      await scriptMockToolCall(seed.request, {
        name: 'calendar_book',
        args: {
          topic: 'Recruiter chat',
          duration_min: 30,
          preferred_times: [t1, t2],
        },
      });

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`/?code=${seed.code.code}`);
      await page.waitForResponse((res) =>
        res.url().endsWith('/api/v1/sessions') && res.status() === 200);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      const skip = page.getByTestId('visitor-name-skip');
      if (await skip.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await skip.click();
      }
      const input = page.locator('[data-testid="chat-input"] input');
      await input.fill('Book a 30-min next week');
      await input.press('Enter');

      // throbber appears as the agent dispatches calendar_book; toolStartedNames
      // accumulates so the li stays visible through the rest of the turn.
      await expect(page.getByTestId('tool-throbber-calendar_book'))
        .toBeVisible({ timeout: 15_000 });

      // turn completes, answer body rendered
      await expect(page.locator('[data-testid="answer-body"]'))
        .toBeVisible({ timeout: 15_000 });

      // mock gcal has no event since both preferred slots were busy
      const events = await getMockEvents(seed.request);
      expect(events).toHaveLength(0);

      await ctx.close();
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
