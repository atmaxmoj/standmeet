// visitor-chat-throbber-reading-dom.spec.ts —— #9 的 DOM 层守护。
//
// throbber-label.spec 验的是 SSE 流(网络层)带了 corpus_read + path;这条补上
// 前端**真把「reading <document>」画进 DOM**那一步 —— owner 在意的是「他到底
// 在读什么要展示出来」,得肉眼可见,不只在网络帧里。
//
// 难点:mock 零延迟 turn 里 throbber 一闪而过(DOM 来不及画)。解法:问句嵌
// [[slow-final:N]] —— gateway 在 corpus_read 之后、出最终答案之前 hold N ms,
// 这段时间 currentTool 还是 corpus_read(tool_completed 不清,llm_chunk 才清),
// throbber「reading X」稳稳挂着能断言。
//
// 这条测试同时守住了一个曾经的真 bug:SSE 经 Next rewrites() 反代会被 buffer 成
// 整条 batch,throbber 的逐帧进度永远画不出来(visitor 只看到 thinking 到答案)。
// 修法是 app/src/app/api/v1/agent/turn/route.ts 流式透传 res.body。它要是退化回
// buffer,这条 read throbber 就再也等不到 → 测试红,正好兜住。

import { test, expect } from '@/fixtures/test';

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
const TARGET_PATH = 'projects/lucerna';
// throbber-label.ts 的 corpus_read formatter 用的读类动词。
const READ_VERBS = ['reading', 'pulling up', 'opening', 'checking', 'digging into'];

test.describe('throbber 在 DOM 里真显「reading <document>」', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'throbber-read-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is a local-first knowledge tool.',
      title: 'Lucerna', path: TARGET_PATH,
    });
    await createCode(request, csrf, {
      code: CODE, label: 'intro', purpose: 'throbber-reading-dom spec',
    });
    await request.dispose();
  });

  test('corpus_read 进行中,DOM 显「<读类动词> <在读的 document>」',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, CODE);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });

      // [[slow-final:2500]]:search→read 之后 hold 2.5s,throbber 停在 reading X。
      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill('tell me about lucerna [[slow-final:2500]]');
      await input.press('Enter');

      // read throbber 在 DOM 里现身(单值,已从 search 顶替成 read)。
      const readThrobber = page.locator('[data-testid="tool-throbber-corpus_read"]');
      await expect(readThrobber).toBeVisible({ timeout: 15_000 });
      const label = (await readThrobber.innerText()).toLowerCase();

      // 文案 = 读类动词 + 在读的那个 document(树派生 path),不是干巴巴一个 "retrieving"。
      expect(READ_VERBS.some((v) => label.includes(v))).toBe(true);
      expect(label).toContain(TARGET_PATH); // 具体到那条 parent_id 树派生路径

      // 互斥:读文档这一刻,throbber 只有 reading 这一个进度指示 —— thinking 那条
      // (answer-pending)必须不在。(之前的 bug:reading 和 thinking 并排同时显,
      // visitor 肉眼看到的是 thinking。) read throbber 还挂着时同步断言 thinking 没了。
      await expect(readThrobber).toBeVisible();
      await expect(page.getByTestId('answer-pending')).toHaveCount(0);

      // turn 落地后 throbber 清掉(顺带确认它确实是临时的)。
      await expect(page.locator('[data-testid="answer-body"]')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('tool-throbbers')).toHaveCount(0, { timeout: 20_000 });
      await ctx.close();
    });
});
