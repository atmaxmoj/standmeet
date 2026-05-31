// agent-loop-iter-visible.spec.ts —— per-iteration throbber 不被后续
// state 盖。3 轮 agent loop (search → read → final) → DOM 上 throbber
// 序列按顺序展示，最终文本只在第 3 轮出现。
//
// 这是 visitor chat 改用 pi-agent-core 后的关键 UX 不变量；先在
// /dev/agent-multi-iter 上跑同 hook (useAgent)，等 visitor chat 切到
// 同样 hook 时这个行为自动继承。

import { test, expect } from '@/fixtures/test';
import { goto } from '@/fixtures/navigate';

test.describe('agent loop · per-iter throbber sequence visible', () => {
  test('3-iter scenario: throbber[0]=corpus_search, throbber[1]=corpus_read, final text shows after',
    async ({ page }) => {
      await goto(page, '/dev/agent-multi-iter');
      await page.getByTestId('multi-iter-send').click();

      // 等 final text 出现 (说明 3 轮 loop 全跑完)
      const finalText = page.getByTestId('multi-iter-final-text');
      await expect(finalText).toContainText('Lucerna is a project about distributed retrieval');

      // throbber 顺序断言
      await expect(page.getByTestId('throbber-0')).toHaveText('corpus_search');
      await expect(page.getByTestId('throbber-1')).toHaveText('corpus_read');
      // 没有 throbber-2 (最后一轮纯 text，无 tool)
      await expect(page.getByTestId('throbber-2')).toHaveCount(0);
    });
});
