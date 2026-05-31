// agent-capability-resync.spec.ts —— D 关键不变量：tool dispatcher
// 返新 capability_state → 前端 store 同步 → 下次 LLM 看不见已 burn 的
// cap。LLM 在第 2 轮 fallback 到剩余可用 tool (corpus_search) 而不是
// 重试 calendar_book。
//
// scenario：role 含 calendar.book quota_remaining=1 + corpus_retrieval；
// LLM 第 1 轮 call calendar_book (burn) → dispatcher 返 cap_state
// 没有 calendar.book → 第 2 轮 LLM 看到的 tool list 只剩 corpus_search
// → call corpus_search → 第 3 轮 final text。

import { test, expect } from '@/fixtures/test';
import { goto } from '@/fixtures/navigate';

test.describe('agent loop · capability cascade resyncs LLM toolset', () => {
  test('burn cap (calendar.book quota=1) → LLM next iter no longer sees it → fallback to corpus_search',
    async ({ page }) => {
      await goto(page, '/dev/agent-resync');
      await page.getByTestId('resync-send').click();

      const finalText = page.getByTestId('resync-final-text');
      await expect(finalText).toContainText('Booked the meeting and pulled context');

      // burn 前 throbber 是 calendar_book；burn 后是 corpus_search
      await expect(page.getByTestId('resync-throbber-0')).toHaveText('calendar_book');
      await expect(page.getByTestId('resync-throbber-1')).toHaveText('corpus_search');

      // capability state 同步 (calendar.book 已 absent)
      await expect(page.getByTestId('resync-calendar-visible')).toHaveText(
        'calendar.book visible: no',
      );
    });
});
