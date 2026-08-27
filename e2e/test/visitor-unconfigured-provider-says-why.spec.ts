// visitor-unconfigured-provider-says-why.spec.ts —— 这台实例没有可用的 AI provider 时，
// **访客**读到的那句话。
//
// 现场（prod，sijie.xyz，刚认领完还没配 provider）：兑码进门、问一句，屏幕上是
//   "The connection dropped before a reply came back. Please try asking again."
// 而后端在同一次响应里发的是
//   503 + `event: error` / `data: {"code":"owner_unconfigured",
//          "message":"This page doesn't have an AI provider set up yet."}`
// —— 连接好好的，产品也**知道**真实原因、还写好了那句人话，只是访客读不到它。
// 而「再问一次」是句没用的建议：owner 不去配，问一万次都是这一句。
//
// 缺陷在客户端那一层：`agent-adapters.ts` 的 `if (!res.ok) throw`，在 body 还没读之前就把
// 整条流扔了，于是 `agent-core` 落到按 status 猜的兜底话术（401/403 说重进，其余一律
// 说「连接断了、再试试」）。**服务端自己写的原因，永远比按状态码猜的强。**
//
// 为什么它一直没被抓到：F-A-24 覆盖的是**同一件事的 owner 那一半**（dashboard 要当面讲），
// 它的注释里甚至照抄了那句正确的话当作访客读到的东西 —— 而没有任何一条用例问过访客。
// 一个缺陷的两半，只测了一半（[[all-tests-are-failure-path]]）。
//
// RED（修复前）：`answer-body` 里是 "connection dropped"，那句 provider 的话一个字都没有。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, clearAIProviderKey, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'unconfigured-provider@example.com',
  password: 'the-server-already-wrote-the-sentence-1',
  handle: 'unconfiguredowner',
  fullName: 'Unconfigured Owner',
};
const CODE = 'NOPROVIDER-01';

test.describe('没有可用 provider 时，访客读到的是真实原因', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(120_000);
    await initOwner(playwright);
  });

  test('访客读到「没配 provider」，而不是「连接断了、再试一次」', async ({ page }) => {
    // 默认 30s 比下面那条断言的 60s 还短 —— 不放宽的话，断言的超时永远够不到，
    // 红的理由会变成「用例超时」，把「屏幕上到底有没有那句话」盖掉。
    test.setTimeout(120_000);
    await enterCodeSession(page, CODE);
    const input = page.getByTestId('chat-input-field');
    await input.fill('What is StandMeet?');
    await input.press('Enter');

    const answer = page.getByTestId('answer-body').last();
    // 先钉住那句正确的话在。它是这条用例的**正对照**：屏幕上先得真有一段答案文字，
    // 下面那条否定断言才有意义（[[negated-assertion-passes-while-absent]]）。
    await expect(answer, '产品说出真实原因：这台实例还没配 provider')
      .toContainText(/AI provider/i, { timeout: 60_000 });

    // 判负的那一半：那句假话不许出现 —— 连接好好的，而「再问一次」永远不会成功。
    await expect(page.locator('body'), '不许说「连接断了」：连接好好的')
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
  await createCode(request, csrf, { code: CODE, label: 'noprovider' });
  // 这个状态得**开出来**：claim 总会种一条可用的 provider（seedDevAIProvider）。
  // 清 key 之后每一个访客的第一句话都被 503 挡回去 —— 正是 prod 上刚认领完那台的样子。
  await clearAIProviderKey(request, { email: OWNER.email, password: OWNER.password });
  await request.dispose();
}
