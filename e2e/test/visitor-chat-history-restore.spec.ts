// visitor-chat-history-restore.spec.ts —— #11:visitor 刷新页面后,chat transcript
// (纯内存)会空。载入时按 session token 拉回这段对话的 Q&A 重建,刷新不丢历史。
//
// 故事:visitor 进 code 会话、问一句、拿到答 → reload → 那条问 + 答还在。
//
// F-A-29:这一轮**必须带工具调用**。以前它问的那句一个工具都不调,于是聚合里 `tool_calls: []`,
// 而真实的每一轮都有检索 —— 当 F-A-28 把检索调用的 `result` 从访客回参里剥掉之后,客户端 schema
// 对着「有工具调用」的那份 payload 直接解析失败、整段历史被丢掉,而这条用例照样绿。
// 它守的是刷新不丢历史,却只走了一种真实世界里不存在的形状。

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

const CODE = 'INTRO-001';
const QUESTION = 'tell me about lucerna';

test.describe('刷新后对话历史恢复', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'history-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is a local-first knowledge tool.',
      title: 'Lucerna', path: 'projects/lucerna',
    });
    await createCode(request, csrf, { code: CODE, label: 'intro' });
    await request.dispose();
  });

  test('问一句 → reload → 那条问 + 答还在',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, CODE);

      // #28: backend 落库在 /agent/turn 流末端(`done` 之前)。提问前挂这条 SSE
      // 响应,res.finished() = 流读完 = 已落库;等它再 reload,否则历史还没进 DB。
      const turnDone = page.waitForResponse((res) =>
        res.url().includes('/agent/turn') && res.status() === 200, { timeout: 20_000 });

      // 真实的一轮总是先检索。检索调用的 result 在下发给访客时被剥掉(F-A-28),而恢复这条路
      // 必须扛得住那个形状 —— 这两个 tag 就是把它带进来。
      const searchTag = await scriptMockToolCall(page.request, {
        name: 'corpus_search', args: { query: 'lucerna' },
      });
      const readTag = await scriptMockToolCall(page.request, {
        name: 'corpus_read', args: { path: 'projects/lucerna' },
      });

      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill(`${QUESTION}${searchTag}${readTag}`);
      await input.press('Enter');
      await expect(page.locator('[data-testid="answer-body"]')).toBeVisible({
        timeout: 20_000,
      });
      const answerBefore = await page.locator('[data-testid="answer-body"]').innerText();
      await (await turnDone).finished();

      // reload:纯内存 transcript 空掉,history endpoint 拉回重建。
      await page.reload();

      // 那条问 + 答恢复了。
      await expect(page.getByText(QUESTION)).toBeVisible({ timeout: 10_000 });
      const answerAfter = await page.locator('[data-testid="answer-body"]').innerText();
      expect(answerAfter.length).toBeGreaterThan(0);
      // 比答案正文:归一空白 + 砍掉 citation footer(live 有 "REFERENCES · N",
      // restore 暂不带 refs,只保 Q&A 文本 —— refs hydration 留后续)。
      const prose = (s: string) => s.replace(/\s+/g, ' ').replace(/REFERENCES.*$/i, '').trim();
      expect(prose(answerAfter)).toBe(prose(answerBefore));

      await ctx.close();
    });
});
