// visitor-unfinished-turn-says-so.spec.ts —— F-A-32:一轮**没有收尾**时,已经流出来的那半截
// 不许冒充完整答案。
//
// 真实环境里长这样:一个逼到预算边界的问题跑了 360 秒,模型在工具调用之间流出的是计划旁白
// (*"Let me peek at the remaining ~39 Level 2 notes to triage, then read them all."*),流在
// `done` 之前断掉(ERR_INCOMPLETE_CHUNKED_ENCODING),而客户端只判「一个字都没收到才报错」——
// 于是那半句计划被当成完成的答案发布,屏幕上没有任何提示,这一轮还算成功、照常计费。
//
// 判据是**尾帧到没到**,不是「有没有文字」:后端在每条路径末尾都无条件发 `done`
// (agent_loop.go:152,错误路径也发),所以缺了它就是确定没收尾。这条用例因此不需要真的把
// socket 掐断 —— 它发一段合法的 SSE:两帧 text,然后**没有** done。缺尾帧就是缺尾帧。
//
// 两条断言缺一不可:
//   1. 那半截内容**还在**(非空守卫;顺便框住「一报错就把 43 条引用和正文全清掉」那种修法);
//   2. 旁边有一句说它没说完。
// 只断第 2 条的话,一个「出错就整屏换成一句话」的实现也能过,而那对访客同样是丢失。

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

const CODE = 'UNFIN-001';

// NARRATION —— 模型在工具之间说的那种话。它读起来像句子,所以「有文字」这个判据看不出问题。
const NARRATION = 'Let me peek at the remaining notes to triage, then read them all.';

// unterminatedStream —— 合法的 SSE:两帧 text,没有 done。真实世界里这是流被掐断的样子,
// 而缺尾帧这件事本身就足以判定「没收尾」。
function unterminatedStream(): string {
  return [
    `event: text\ndata: ${JSON.stringify({ delta: NARRATION })}\n\n`,
    `event: text\ndata: ${JSON.stringify({ delta: '' })}\n\n`,
  ].join('');
}

test.describe('没收尾的一轮要说出来', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'unfinished-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is a local-first knowledge tool.',
      title: 'Lucerna', path: 'projects/lucerna',
    });
    await createCode(request, csrf, {
      code: CODE, label: 'unfinished', purpose: 'F-A-32 guard',
    });
    await request.dispose();
  });

  test('流在 done 之前结束 → 半截内容还在,而且旁边说它没说完', async ({ browser }) => {
    test.setTimeout(180_000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await enterCodeSession(page, CODE);

    // 会话已经建好之后才接管这个端点 —— 否则连进门那步都被改了。
    await page.route('**/api/v1/agent/turn', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
        body: unterminatedStream(),
      });
    });

    const input = page.locator('[data-testid="chat-input-field"]');
    await input.fill('walk the whole link graph for me');
    await input.press('Enter');

    // 1) 那半截还在 —— 也是非空守卫:先证这一轮真的流出来了东西。
    await expect(page.getByTestId('answer-body')).toContainText(NARRATION, { timeout: 30_000 });

    // 2) 而且它没有冒充完整答案。
    await expect(page.getByTestId('answer-partial-notice')).toBeVisible({ timeout: 30_000 });

    await ctx.close();
  });
});
