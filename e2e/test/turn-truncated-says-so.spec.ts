// turn-truncated-says-so.spec.ts —— F-A-34。模型的**输出预算**用完时，那半句话不许
// 冒充完整答案。
//
// 一次生成有三种收场：说完了（end_turn）、要调工具（tool_use）、**预算用完了**
// （max_tokens）。第三种不是错误 —— 流正常关闭 —— 于是 agent loop 那套"任何预算耗尽
// 都要有边界"的设计（agent_loop_budget.go 给迭代/超时/终止错误都配了 forceFinalAnswer）
// 恰好漏掉了它：turn 正常收尾，正文停在半句上，后面照常跟一个 REFERENCES 页脚。
//
// 真环境撞见的样子（prod，真 vault，190 秒的长 turn）：第 35 条正文是
// "Voice as a trainable, transferable property — **which is**"，然后就没了。
//
// 而这个信息**全程都在手上**：`agent_loop.go:326` 把 provider 的 finish reason 归一成
// end_turn｜tool_use｜max_tokens，`:152` 的 sink.Done(state.stop) 把它当 SSE 的
// `stop_reason` 发给浏览器，SDK 的 agent-turn-sse.ts:115 认认真真解析成 stopReason ——
// 然后全仓再没有第二处引用它。缺的不是通路，是**消费者**。
//
// 这条守卫走访客的真界面：注册一条以 max_tokens 收尾的回复，断言那半句话**旁边有一句话
// 说它没说完**（复用 F-A-32 建的 partial-notice 槽：残缺正文 + 引用 + 一句人话都留着）。

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import {
  scriptMockReplyText, scriptMockReplyTruncated, scriptMockToolCall,
} from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'trunc@example.com',
  password: 'truncated-turn-pass-1',
  handle: 'trunc',
  fullName: 'Truncated Turn Owner',
};

const CODE = 'TRUNC-001';
// 半句话 —— 真环境那次就是这个形状：句子停在连接词上。
const HALF = 'Voice is a trainable, transferable property — which is';
const WHOLE = 'Voice is a trainable, transferable property, and that is the whole answer.';

test.describe('F-A-34 · a turn cut short by the output budget says so', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000); // resetInstance 在负载高时要 ~48s，而钩子默认只给 30s
    await initOwner(playwright);
  });

  test('the half sentence carries a notice; a complete answer carries none',
    async ({ page, playwright }) => {
      const request = await playwright.request.newContext();
      await enterCodeSession(page, CODE, 'Reader');

      // 1) 预算用完的那一轮。
      const cutTag = await scriptMockReplyTruncated(request, HALF);
      await ask(page, `tell me about voice ${cutTag}`);
      const notice = page.getByTestId('answer-partial-notice');
      await expect(notice,
        'the visitor is told the answer stopped early, instead of reading half a clause as finished')
        .toBeVisible({ timeout: 20_000 });
      // 取文本再判：`.not.toContainText` 在元素还没出现时也算通过。
      const said = (await notice.innerText()).toLowerCase();
      expect(said, '说的是它没说完，而不是报错').toMatch(/cut short/);

      // 2) 反向：正常说完的那一轮**不许**挂这个提示 —— 每条都提示等于没提示。
      // 数总数：第一轮那条还在（1），第二轮不许再添一条。
      const wholeTag = await scriptMockReplyText(request, WHOLE);
      await ask(page, `and again ${wholeTag}`);
      await expect(page.getByText('the whole answer', { exact: false }))
        .toBeVisible({ timeout: 20_000 });
      expect(await notice.count(),
        'a complete answer adds no cut-short notice of its own').toBe(1);

      await request.dispose();
    });

  // F-A-40 —— 同一条路的**更狠的一头**：预算用完时正文是**空的**。
  //
  // prod 上真模型驱出来的样子：`SEARCHED 51 · READ 4` → 正文空白 → 一句「this answer was
  // cut short — ask for the rest」，而根本没有 rest。日志 `stop=max_tokens answer_chars=0`：
  // 没撞超时、没撞迭代上限，是模型把**自己的输出预算**全花在工具调用上，一个字没写。
  // 那不是 error，所以它绕开了 handleTerminalError 那道收口 —— 这条路上以前只有预算，
  // 没有边界，而判据第一句就写着「the boundary is engineered; a bigger budget is not one」。
  //
  // 这里造的正是那个形状：先跑一次真检索（于是证据在手），再让那一轮以 max_tokens + 空正文
  // 收场。断言访客**拿到了一个答案**（边界那次无 tool 合成的产物），而不是一句
  // 「去问剩下的」。
  test('预算用完、一个字都没写的那一轮:访客拿到的是答案,不是一句「去问剩下的」',
    async ({ page, playwright }) => {
      const request = await playwright.request.newContext();
      await enterCodeSession(page, CODE, 'Reader');

      const toolTag = await scriptMockToolCall(request, {
        name: 'corpus_search', args: { query: 'voice' },
      });
      // 空正文 + max_tokens：模型把预算全花在工具上了。
      const emptyTag = await scriptMockReplyTruncated(request, '');
      await ask(page, `crawl everything about voice ${toolTag}${emptyTag}`);

      // 边界那一次合成没有脚本可用 → mock 回默认那句。**有字**才是这条要证的东西。
      // 取**最后一条**：这一屏上还有进场时那条欢迎语，`answer-body` 不止一个。
      //
      // 判据落在**边界那次合成的指纹**上，而不是「屏幕上有字」：mock 会把 system 原样回声，
      // 而只有强制收口那一次的 system 里带着那句 nudge（`forceFinalNudge`）。
      // 光断「非空」的话，将来哪天正常那一轮漏出半句也能让它绿。
      await expect(
        page.getByTestId('answer-body').last(),
        '预算用完不等于访客空手而归 —— 证据都在手上,边界要把它合成成一个答案',
      ).toContainText('used your search budget for this turn', { timeout: 30_000 });
      expect(
        await page.getByTestId('answer-partial-notice').count(),
        '救回来之后不该再说「这条没说完、去问剩下的」—— 没有剩下的',
      ).toBe(0);

      await request.dispose();
    });
});

async function ask(page: Page, q: string): Promise<void> {
  await page.getByTestId('chat-input-field').fill(q);
  await page.getByTestId('chat-input-field').press('Enter');
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'trunc-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'voice as instrument intro.', title: 'Voice Intro',
  });
  await createCode(request, csrf, { code: CODE, label: 'Truncation' });
  await request.dispose();
}
