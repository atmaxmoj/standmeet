// agent-tool-result-attribution.spec.ts —— F-S-1：一轮里派了 N 次工具调用，就该有 N 条**各自
// 归因得到**的结果。
//
// 怎么撞上的：驱 corpus-search 的 check 2 ⭐ 时，agent 在一轮里同时发了 `recursive convergence`
// 和 `递归收敛` 两个 `corpus_search`。回来两条 `agent tool done`：一条 `result_bytes:2`（空）、
// 一条 7883。**哪条属于哪次搜索，日志里没有任何字段能回答** —— `start` 带 args，`done` 只有
// name + 字节数，而并行派发让先后顺序不作数。于是「CJK 查询到底命中没有」这个问题今天无法回答，
// 而它正是那条 check 的后半段。
//
// **为什么断言的对象是日志，不是产品的面。** 这个不变量说的是「一次调用和它的结果之间有没有可
// 追溯的联系」；产品的界面上只有汇总（`SEARCHED 9 · READ 4`），API 也不下发单次调用的结果。
// 日志就是这个事实唯一存在的地方，所以守卫必须读日志（[[read-the-key-not-the-name]]）。
//
// **它一度写不出来。** 复现需要一轮里同名工具被调用两次，而 mock 一轮只发一个 tool_use ——
// 好几个 item 把自己的 backing test 标 `gap`，理由都是这一句。mock 现在能一条消息派多个调用了，
// 这条守卫才有可能存在。

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken, backendLogTail } from '@/fixtures/instance';
import { scriptMockParallelToolCalls } from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';

const OWNER = {
  email: 'tool-attrib@example.com', password: 'correct-horse-battery-staple',
  handle: 'toolattrib', fullName: 'Tool Attribution Owner',
};
const CODE = 'ATTRIB-01';

test.describe('F-S-1 · a tool result can be traced back to the call that produced it', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('two searches in one turn → two results, each attributable to its own call',
    async ({ page, playwright }) => {
      const request = await playwright.request.newContext();
      // 同名、不同 query —— 正是归因坍塌的那个形状。
      const tag = await scriptMockParallelToolCalls(request, [
        { name: 'corpus_search', args: { query: 'attribution-probe-alpha' } },
        { name: 'corpus_search', args: { query: 'attribution-probe-beta' } },
      ]);
      await request.dispose();

      await enterCodeSession(page, CODE);
      await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
      const input = page.getByTestId('chat-input-field');
      await input.fill(`hello${tag}`);
      await input.press('Enter');
      // 等这一轮**真的结束**，不是等一段时间：进度条出现说明工具开始跑，消失说明这一轮收了。
      // 定时等在慢机器上会在两次调用都还没回来时就去读日志，读到半截然后判"只有一条结果"——
      // 一个会伪装成产品缺陷的用例缺陷。
      const progress = page.getByTestId('chat-progress');
      await expect(progress).toBeVisible({ timeout: 15_000 });
      await expect(progress).toBeHidden({ timeout: 30_000 });

      const log = backendLogTail();
      const starts = toolLines(log, 'agent tool start', 'corpus_search');
      const dones = toolLines(log, 'agent tool done', 'corpus_search');

      // 正对照：mock 真的派了两次，而且两次都跑完了。缺了这一条，下面的断言在
      // 「一次都没跑」时也会绿（[[assertion-that-cannot-fail]]）。
      expect(starts.length, 'the turn dispatched two corpus_search calls').toBe(2);
      expect(dones.length, 'both calls produced a result').toBe(2);

      // 真正的不变量：每条结果都带着能指回它那次调用的东西。今天 done 行只有 name +
      // result_bytes，两条长得一模一样 —— 于是这个 Set 只有 1 个元素，红。
      const fingerprints = new Set(dones.map(attributionKeyOf));
      expect(
        fingerprints.size,
        'each result carries something that identifies which call it came from',
      ).toBe(2);
    });
});

// toolLines —— 日志里某类工具行。docker compose 的输出带服务名前缀，所以按子串取。
function toolLines(log: string, msg: string, tool: string): string[] {
  return log.split('\n').filter((l) => l.includes(`"${msg}"`) && l.includes(`"${tool}"`));
}

// attributionKeyOf —— 一条结果行上「说明它来自哪次调用」的部分。
//
// 刻意**不含** result_bytes：两次调用完全可能返回同样多的字节，那时按字节数分辨就是碰运气。
// 要的是调用自己的身份（call id 或它的 args），所以取除时间戳与字节数以外的部分。
function attributionKeyOf(line: string): string {
  return line
    .replace(/"time":"[^"]*",?/, '')
    .replace(/"result_bytes":\d+,?/, '')
    .trim();
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const role = await createRole(request, csrf, {
    name: 'attrib-role', description: 'tool attribution spec',
    corpus_uris: ['wiki://**', 'output://**'],
  });
  await createCode(request, csrf, { code: CODE, label: 'attrib', role_id: role.id });
  await request.dispose();
}
