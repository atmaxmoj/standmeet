// agent-spike-hook.spec.ts —— /dev/agent-spike 路由验 useAgent hook
// 行为：点 "send" → agent-core 跑两轮 (tool_call → text) → DOM 上按
// 顺序出现期望事件 + 最终 assistant message。
//
// 跟 visitor chat UI 解耦的烟测。adapters 是 scripted + in-memory，
// 不依赖后端 inference / tool dispatcher。

import { test, expect } from '@/fixtures/test';

import { goto } from '@/fixtures/navigate';

test.describe('agent-spike · useAgent hook end-to-end', () => {
  test('send triggers iteration_started → tool_call → tool_completed → final_text + messages',
    async ({ page }) => {
      await goto(page, '/dev/agent-spike');
      await page.getByTestId('agent-spike-send').click();

      // events appear in order
      await expect(page.getByTestId('agent-event-iteration_started').first()).toBeVisible();
      await expect(page.getByTestId('agent-event-llm_tool_request')).toBeVisible();
      await expect(page.getByTestId('agent-event-llm_tool_request')).toHaveText(
        /llm_tool_request: corpus_search/,
      );
      await expect(page.getByTestId('agent-event-tool_started')).toBeVisible();
      await expect(page.getByTestId('agent-event-tool_completed')).toBeVisible();
      await expect(page.getByTestId('agent-event-final_text')).toBeVisible();
      await expect(page.getByTestId('agent-event-final_text')).toContainText(
        'projects/lucerna',
      );

      // user + assistant messages on the message list
      const userMsg = page.getByTestId('agent-message-user');
      const asstMsg = page.getByTestId('agent-message-assistant').last();
      await expect(userMsg).toContainText('tell me about lucerna');
      await expect(asstMsg).toContainText('projects/lucerna');
    });
});
