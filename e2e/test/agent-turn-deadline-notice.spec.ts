// agent-turn-deadline-notice.spec.ts —— F-A-44。**撞了时间墙、连救场也没来得及**那一格，
// 产品对访客说什么。
//
// 真实环境里的样子（prod，真模型）：问一个逼着三层深爬的问题 → 屏幕上跑到
// `SEARCHED 4 · READ 64` → 六分钟后那一格变成
//   "The connection dropped before a reply came back. Please try asking again."
// 连接好好的，撞的是 300 秒的墙；而「再问一次」会撞同一堵墙。日志逐行摆着：
// `forcing final answer evidence_items:24` → 60 秒后 `force-final generate: context deadline
// exceeded` → `answer_chars=0 recovered=false`。
//
// **为什么要一个自己的台子**：那两个预算是进程级的（300s / 60s），默认套件里没法在一条用例上
// 调短，所以这条路一直没被驱过。走 `make test-boundary`（AGENT_TURN_TIMEOUT=5 +
// FORCE_FINAL_TIMEOUT=3）。两个都短才走得到「救场也没救回来」；只短前一个的话，救场会把它
// 救回来 —— 那是好路径，不是这条用例要的。
//
// 没有那个台子就整组跳过 —— 一条永远红的用例只会教人忽略红色（captcha 那五条的教训）。
//
// RED（修复前）：`handleTerminalError` 在救场返回空串时走 `em.sink.Error(err)`，
// 于是前端渲通用错误话术，屏幕上出现 "connection dropped"，而 `turn-notice` 不存在。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { scriptMockReplyText, scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'deadline-notice@example.com',
  password: 'the-wall-states-its-own-reason-1',
  handle: 'deadlineowner',
  fullName: 'Deadline Owner',
};
const CODE = 'DEADLINE-01';
// 比两个预算（5s + 3s）都长 —— 模型这一轮怎么都答不回来，两堵墙都撞上。
const SLOWER_THAN_BOTH_WALLS_MS = 20_000;

test.describe('F-A-44 · 时间用完那一轮，产品说的是时间，不是「连接断了」', () => {
  test.beforeAll(async ({ playwright }) => {
    test.skip(process.env['BOUNDARY_TIGHT'] !== '1',
      '要短预算的台子 —— 走 `make test-boundary`');
    test.setTimeout(180_000);
    await initOwner(playwright);
  });

  test('撞墙的一轮说自己没时间了，并让访客问得更窄', async ({ page, playwright }) => {
    const req = await playwright.request.newContext();
    // **先攒到证据，再撞墙** —— prod 上那一次是这个形状（`READ 64`，24 条证据在手），
    // 而「零工具就撞墙」走的是另一条路（`no_answer`：手里什么都没有）。少了这次工具调用，
    // 用例驱的就不是它要驱的那一格。
    const toolTag = await scriptMockToolCall(req, {
      name: 'corpus_search', args: { query: 'boundary' },
    });
    // **两份都要慢**：撞墙之后的救场是**另一次**调用，只注册一份的话它会拿到默认回复、
    // 瞬间成功 —— 那是「边界救回来了」那一格（好路径），不是这条用例要驱的。
    const tag = await scriptMockReplyText(
      req, 'never arrives', { delayMs: SLOWER_THAN_BOTH_WALLS_MS });
    const rescueTag = await scriptMockReplyText(
      req, 'the rescue never arrives either', { delayMs: SLOWER_THAN_BOTH_WALLS_MS });
    await req.dispose();

    await enterCodeSession(page, CODE);
    const input = page.getByTestId('chat-input-field');
    await input.fill(`walk everything and tell me all of it${toolTag}${tag}${rescueTag}`);
    await input.press('Enter');

    const notice = page.getByTestId('answer-partial-notice');
    await expect(notice, '这堵墙自己说明了理由').toBeVisible({ timeout: 60_000 });
    await expect(notice, '说的是时间，而且给的下一步是「问得更窄」')
      .toContainText(/out of time/i);

    // 判负的那一半：那句假话不许再出现。
    // 先断上面那条提示已经在（否则这条在页面还空着时也算通过，
    // [[negated-assertion-passes-while-absent]]）。
    await expect(page.locator('body'), '不许再说「连接断了」—— 连接好好的')
      .not.toContainText(/connection dropped/i);
  });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request: APIRequestContext = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'deadline-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'the boundary is engineered, not budgeted.', title: 'Boundary',
  });
  await createCode(request, csrf, { code: CODE, label: 'deadline' });
  await request.dispose();
}
