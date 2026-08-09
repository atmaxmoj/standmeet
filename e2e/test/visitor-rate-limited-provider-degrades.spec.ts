// visitor-rate-limited-provider-degrades.spec.ts —— agent-loop-robustness checks 4 + 5,
// 端到端。
//
// 这两条一直被记成「缺一个能注入限流响应的代理」。那个代理不是外部装置 —— mock 早就会注入
// 500(`next_error`),429 只是另一个状态码加一个头,于是加了 `next_rate_limit
// {key, retry_after_seconds}`。500 和 429 的区别正是这里要测的:500 是「坏了」,429 是
// 「**别这么快再来**」,而后者带着 provider 明说的间隔 —— 提前重打会加重封禁。
//
// 两条断言:
//   check 5 ⭐ —— 整轮耗时 ≥ provider 要求的间隔(提示被真的听进去了,不只是 Go 单测里听进去);
//   check 4  —— 访客拿到的是一句人话,不是 429 / 栈 / 错误对象。
//
// 断的是**时间 + 屏幕上的字**,不是日志:owner 看不到日志,访客更看不到。

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { createCode } from '@/fixtures/codes';
import { enterCodeSession } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { scriptMockRateLimit } from '@/fixtures/mock-llm-script';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'RATELIMIT-001';
// RETRY_AFTER_S —— provider 要求的间隔。取 2s:够长到「没听」和「听了」区分得开,
// 又不至于让用例空等。
const RETRY_AFTER_S = 2;
// LEAK_MARKERS —— 这些出现在访客眼前就是漏了底层。
const LEAK_MARKERS = /429|rate.?limit|NodeRunError|goroutine|panic|eino|http\.Client/i;

test.describe('a rate-limited provider degrades to a sentence, after waiting', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'ratelimit-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is a local-first knowledge tool.',
      title: 'Lucerna', path: 'projects/lucerna',
    });
    await createCode(request, csrf, {
      code: CODE, label: 'rate limit', purpose: 'agent-loop-robustness 4+5',
    });
    await request.dispose();
  });

  test('honours the provider Retry-After, then says something a visitor can act on',
    async ({ browser }) => {
      test.setTimeout(180_000);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, CODE);

      const tag = await scriptMockRateLimit(page.request, RETRY_AFTER_S);

      const input = page.locator('[data-testid="chat-input-field"]');
      const started = Date.now();
      await input.fill(`tell me about lucerna${tag}`);
      await input.press('Enter');

      // 访客眼前必须出现点什么 —— 不许卡在 pending 上。
      const body = page.locator('[data-testid="answer-body"]');
      await expect(body).toBeVisible({ timeout: 90_000 });
      const elapsed = Date.now() - started;
      const shown = await body.innerText();

      // check 5 ⭐:provider 说等 N 秒,那就至少等了 N 秒。
      expect(elapsed, 'must not retry before the provider said it could')
        .toBeGreaterThanOrEqual(RETRY_AFTER_S * 1000);
      // 非空守卫:先证屏幕上真的有话,否则「不含泄漏标记」空字符串也满足。
      expect(shown.trim().length, 'the visitor must be told something').toBeGreaterThan(0);
      // check 4:那句话是人话,不是底层。
      expect(shown, `visitor saw raw internals: ${shown}`).not.toMatch(LEAK_MARKERS);

      await ctx.close();
    });
});
