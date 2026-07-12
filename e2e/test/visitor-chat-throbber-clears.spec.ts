// visitor-chat-throbber-clears.spec.ts —— throbber 是「turn 进行中」的临时进度,
// turn 落地后必须消失,由折叠的 `searched · N entries` 卡接管。
//
// 复现的 bug:ConversationDeck 把 <ToolThrobbers> 渲在 pending gate 之外,且
// withAnswer 把 toolStarted 留在 finalized dialog 上 —— 结果回答出完了,那串
// SEARCHING / PULLING UP / READING 还冻在 transcript 里跟答案并排。
//
// 不变量:答案卡(tool-card-corpus_search,只在 !pending 时渲)一出现 = turn 已
// 落地,此刻 tool-throbbers 必须 count==0。

import { test, expect } from '@/fixtures/test';

import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { createCode } from '@/fixtures/codes';
import { enterCodeSession } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'INTRO-001';

test.describe('throbber 在 turn 落地后清掉,不冻在 transcript 里', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'throbber-clears-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is a local-first knowledge tool.',
      title: 'Lucerna', path: 'projects/lucerna',
    });
    await createCode(request, csrf, {
      code: CODE, label: 'intro', purpose: 'throbber-clears spec',
    });
    await request.dispose();
  });

  test('答案落地后 throbber 消失,折叠的 searched 卡接管',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      await enterCodeSession(page, CODE);

      // Pure-registration mock: the turn runs a tool only if the test scripts it.
      // The `searched` card (mcp-app-card-corpus_search) needs corpus_search to run;
      // the citation footer needs corpus_read. Register both — each fires on a
      // successive inference call in the same turn (single-shot per key).
      const searchTag = await scriptMockToolCall(page.request, {
        name: 'corpus_search', args: { query: 'lucerna' },
      });
      const readTag = await scriptMockToolCall(page.request, {
        name: 'corpus_read', args: { path: 'projects/lucerna' },
      });
      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill(`tell me about lucerna${searchTag}${readTag}`);
      await input.press('Enter');

      // searched 卡(retrieval ui:// 沙盒 iframe)+ citation 出现 = 这轮真检索 + 回答了。
      const searchCard = page.getByTestId('mcp-app-card-corpus_search');
      await expect(searchCard).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('citations')).toBeVisible();

      // 不变量:throbber 是实时观察,turn 一落地(finalize)就清成 null 而消失。
      // toHaveCount(0) 会一直 retry 等它消失 —— 旧 bug 下它永不消失 → 超时挂;
      // 修好后 finalize 清掉 → 通过。绝不跟答案并排冻在 transcript 里。
      await expect(page.getByTestId('tool-throbbers')).toHaveCount(0, { timeout: 20_000 });

      await ctx.close();
    });
});
