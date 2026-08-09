// visitor-retrieval-summary-counts-every-tool.spec.ts —— F-A-29: 那行 "searched N · read M"
// 是给访客的**回执**,所以它必须数**每一个**检索工具,而不是某一份手抄的名单里的那几个。
//
// 真实环境驱出来的:一轮里 agent 跑了 2 次 corpus_search + 3 次 corpus_grep + 1 次 corpus_read,
// 而访客看到的是 `searched 2 · read 1` —— 3 次 grep 既不计数也不渲卡,完全隐形。原因是前端把
// 检索族写成了一份 4 个名字的字面量,而后端注册的是 8 个。
//
// 断言的是**覆盖**,不是某个具体数字:一轮里把 8 个 corpus_* 挨个调一遍,总数必须对得上。
// 这样以后再加第 9 个工具,这条会红 —— 而按名单写的判定不会。
//
// 分桶:开一条具体条目的(corpus_read / corpus_peek)算 read,其余算 search。peek 归 read 是因为
// 它拿的是那条笔记自己的内容(签名),而不是"哪些笔记可能相关"。

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

const CODE = 'RETRSUM-001';
const PATH = 'projects/lucerna';

// 每一个后端注册的 corpus_* 检索工具各调一次。加了新工具就往这儿加一行 —— 而**忘记**加的时候,
// 下面 EXPECTED_* 的和对不上,这条会红。
const RETRIEVAL_CALLS = [
  { name: 'corpus_search', args: { query: 'lucerna' }, bucket: 'search' },
  { name: 'corpus_list', args: { path: 'projects' }, bucket: 'search' },
  { name: 'corpus_links', args: { path: PATH }, bucket: 'search' },
  { name: 'corpus_map', args: { budget: 50 }, bucket: 'search' },
  { name: 'corpus_resolve', args: { name: 'Lucerna' }, bucket: 'search' },
  { name: 'corpus_grep', args: { pattern: 'lucerna' }, bucket: 'search' },
  { name: 'corpus_read', args: { path: PATH }, bucket: 'read' },
  { name: 'corpus_peek', args: { paths: [PATH] }, bucket: 'read' },
] as const;

const EXPECTED_SEARCHES = RETRIEVAL_CALLS.filter((c) => c.bucket === 'search').length;
const EXPECTED_READS = RETRIEVAL_CALLS.filter((c) => c.bucket === 'read').length;

test.describe('检索回执数得全', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'retrieval-summary-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is a local-first knowledge tool.',
      title: 'Lucerna', path: PATH,
    });
    await createCode(request, csrf, {
      code: CODE, label: 'retrieval summary', purpose: 'F-A-29 guard',
    });
    await request.dispose();
  });

  test('一轮里每个 corpus_* 工具都进那行计数', async ({ browser }) => {
    // 默认 30s 不够:这条要付一次冷启会话(实测 ~20s,三个沙箱首次 spawn)**再**跑 8 次工具调用。
    // 30s 会在断言之前先超时,于是失败信息指向"元素没出现",而不是它到底数对没数对。
    test.setTimeout(180_000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await enterCodeSession(page, CODE);

    let tags = '';
    for (const call of RETRIEVAL_CALLS) {
      tags += await scriptMockToolCall(page.request, {
        name: call.name, args: call.args,
      });
    }

    const input = page.locator('[data-testid="chat-input-field"]');
    await input.fill(`tell me about lucerna${tags}`);
    await input.press('Enter');

    const summary = page.getByTestId('retrieval-summary');
    await expect(summary).toBeVisible({ timeout: 30_000 });

    // 非空守卫:先证这一行真的在报数,否则"两个数都是 0"也能让下面的断言看起来讲得通。
    await expect(summary).not.toHaveText('');

    await expect(summary).toContainText(`searched ${EXPECTED_SEARCHES}`);
    await expect(summary).toContainText(`read ${EXPECTED_READS}`);

    await ctx.close();
  });
});
