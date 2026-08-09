// visitor-speaker-precedes-telemetry.spec.ts —— UX-31:一轮回答里,「谁在说话」必须排在
// 「这一轮检索了几次」之前。
//
// 设计评审看出来的(不是驱 Steps 驱出来的):真实环境里的阅读顺序是
// `YOU → 问题 → SEARCHED 2 · READ 5 → AI → 回答` —— 眼睛在知道谁在说话之前先撞上一行机器
// 统计,而这个产品的整个论点是「AI 用 owner 的声音回答」。归因在 `ChatTranscript.tsx`:
// `ToolCallCards` 排在 `AnswerView` 之前。
//
// 断的是**几何**,不是 DOM 顺序:读者看到的是屏幕上谁在上面。DOM 里排前面但被 CSS 挪下去
// 一样是坏的(这一轮已经吃过一次「文本断言看不见版面」的亏,见 F-A-25)。

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { createCode } from '@/fixtures/codes';
import { enterCodeSession } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'SPEAKER-001';

test.describe('the speaker label comes before the turn telemetry', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'speaker-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is a local-first knowledge tool.',
      title: 'Lucerna', path: 'projects/lucerna',
    });
    await createCode(request, csrf, { code: CODE, label: 'speaker', purpose: 'UX-31 guard' });
    await request.dispose();
  });

  test('AI label sits above the searched/read line, not below it', async ({ browser }) => {
    test.setTimeout(180_000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await enterCodeSession(page, CODE);

    // 有检索的一轮才会有那行遥测 —— 没有它,这条断言就没有对象可比(空集假绿)。
    const searchTag = await scriptMockToolCall(page.request, {
      name: 'corpus_search', args: { query: 'lucerna' },
    });
    const readTag = await scriptMockToolCall(page.request, {
      name: 'corpus_read', args: { path: 'projects/lucerna' },
    });

    const input = page.locator('[data-testid="chat-input-field"]');
    await input.fill(`tell me about lucerna${searchTag}${readTag}`);
    await input.press('Enter');

    const speaker = page.getByTestId('answer-speaker');
    const telemetry = page.getByTestId('retrieval-summary');
    await expect(speaker).toBeVisible({ timeout: 30_000 });
    await expect(telemetry).toBeVisible({ timeout: 30_000 });

    const speakerBox = await speaker.boundingBox();
    const telemetryBox = await telemetry.boundingBox();
    expect(speakerBox, 'speaker label must be laid out').not.toBeNull();
    expect(telemetryBox, 'telemetry line must be laid out').not.toBeNull();
    // 谁在说话,必须先看到。
    expect(speakerBox!.y).toBeLessThan(telemetryBox!.y);

    await ctx.close();
  });
});
