// visitor-composer-receipt.spec.ts —— F-A-42。**这一轮什么时候算结束**，以及输入框凭什么开锁。
//
// 真环境量出来的（prod，真模型）：答案写完之后输入框还锁着 10–26 秒，而它长得完全就绪
// （`›` + `ask…` + `ASK ↵`）。往里打 20 个字，一个都没进去。开锁时刻每次都紧跟 HTTP
// 响应体关闭（误差 30ms 内）—— 客户端拿**流的寿命**当**轮的寿命**。
//
// 而产品自己写着凭据是哪一帧（`agent-core/src/agent-turn.ts:125`）：
//   「尾帧本身不渲任何东西，但**它到没到**是这一轮唯一可靠的『说完了』凭据」
// `done` 帧在 `sink.Done()` 就发了；之后的 `emitEpilogue` 是一次真的 LLM 调用（ghost），
// 流当然还开着。设计没错，错在没人接那个回执（[[nonunique-signal-not-a-receipt]]）。
//
// **替身必须会慢，否则这条缝在 e2e 里根本不存在**（[[stand-in-is-politer-than-reality]]）：
// mock 的 ghost 调用是瞬时的 → 「轮已收场、流还开着」的窗口塌成 0 → 守卫在坏代码上照样绿。
// 所以 `scriptMockGhost` 新增 `delayMs`，只拖慢 epilogue 那一次调用，不拖慢答案。
//
// 判据一律写成**「人能不能在这儿打字」**（`toBeEditable`），不写成「某个 class 在不在」：
// 访客付的代价就是打进去的字有没有落地。
//
// RED（修复前）：
//   · 用例 1 —— 答案早已渲完，输入框在 epilogue 的 6 秒里一直 disabled → 2s 内不可编辑，红。
//   · 用例 2 —— 一轮在飞的时候输入框 disabled，打的字全丢 → 红。
//   · 用例 3 —— `use-chat.ts` 的 `ask()` 在 pending 时直接 `return`，第二问被静默丢掉 → 红。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { enterCodeSession } from '@/fixtures/navigate';
import { scriptMockGhost, scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { createRole } from '@/fixtures/roles';

const OWNER = {
  email: 'composer-receipt@example.com',
  password: 'the-receipt-is-the-done-frame-1',
  handle: 'receiptowner',
  fullName: 'Receipt Owner',
};
const CODE = 'RECEIPT-01';

// epilogue 要慢到「肉眼可辨的一段死等」，又不能慢到把用例拖垮。6 秒 = 真环境 10–26 秒的缩尺。
const EPILOGUE_MS = 6_000;
// 开锁必须发生在收到回执之后的这个窗口内。给 1.5 秒是留给渲染，不是留给等流。
const UNLOCK_WINDOW_MS = 1_500;
// 一轮「正在答」要持续这么久 —— 访客在这段时间里想到下一个问题是常态，不是边角。
const IN_FLIGHT_MS = 6_000;

const WP = {
  waypoint_id: 'grasp-alpha', description: 'understand Alpha',
  weight: 5, evidence_refs: ['wiki://alpha'], is_terminal: false,
};
// epilogue 真跑起来才有那段窗口 —— role 得带 waypoint，否则 ghost 那一步整个跳过。
const POLICY_GHOST = {
  text: 'What made you take on Alpha?',
  target_waypoint: 'grasp-alpha',
  follows_from: 'you mentioned Alpha',
  is_bridge: false,
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.beforeAll(async ({ playwright }) => {
  await initOwner(playwright);
});

test.describe('F-A-42 · 一轮的结束认在 done 回执上，不认在字节流上', () => {
  test('答案落地就能接着问 —— 不等 epilogue 把流关掉', async ({ page, playwright }) => {
    const req = await playwright.request.newContext();
    const answerTag = await scriptMockReplyText(req, 'Alpha is the thing I shipped.');
    const ghostTag = await scriptMockGhost(req, POLICY_GHOST, { delayMs: EPILOGUE_MS });
    await req.dispose();

    await enterChatWithCode(page);
    const input = page.getByTestId('chat-input-field');
    await input.fill(`what did you ship${answerTag}${ghostTag}`);
    await input.press('Enter');

    // 答案到了 = 这一轮对访客已经结束。后面那 6 秒服务端在生成 ghost，跟他没关系。
    await expect(page.getByTestId('answer-body'), '答案落地')
      .toContainText('Alpha is the thing I shipped', { timeout: 20_000 });

    await expect(input, '答案落地之后输入框必须立刻能用（红：要等 epilogue 关流）')
      .toBeEditable({ timeout: UNLOCK_WINDOW_MS });

    // ghost 仍然会来 —— 早开锁不等于把 epilogue 扔了（别用一个缺陷换另一个）。
    await expect(input, 'epilogue 的 ghost 照旧到达')
      .toHaveAttribute('data-ghost', POLICY_GHOST.text, { timeout: 15_000 });
  });

  test('答的过程中打的字不会被吃掉', async ({ page, playwright }) => {
    const req = await playwright.request.newContext();
    // 答案本身也得会慢 —— 否则「一轮在飞」的窗口在 e2e 里根本不存在，这条断言判不了负。
    const answerTag = await scriptMockReplyText(
      req, 'Still writing that one out.', { delayMs: IN_FLIGHT_MS });
    await req.dispose();

    await enterChatWithCode(page);
    const input = page.getByTestId('chat-input-field');
    await input.fill(`tell me about Alpha${answerTag}`);
    await input.press('Enter');

    // 上一轮还在飞的时候，访客想到了下一个问题就会开始打 —— 产品不能置灰把它吃掉
    // （全局第 10 条：接受请求并排队，不要置灰）。
    await expect(input, '一轮在飞时输入框仍可编辑（红：disabled）')
      .toBeEditable({ timeout: 3_000 });
    await input.fill('and who else worked on it');
    await expect(input, '打进去的字留在框里').toHaveValue('and who else worked on it');
  });

  test('答的过程中按下发送 → 排队，不是丢掉', async ({ page, playwright }) => {
    const req = await playwright.request.newContext();
    const firstTag = await scriptMockReplyText(
      req, 'The first answer.', { delayMs: IN_FLIGHT_MS });
    const secondTag = await scriptMockReplyText(req, 'The second answer.');
    await req.dispose();

    await enterChatWithCode(page);
    const input = page.getByTestId('chat-input-field');
    await input.fill(`first question${firstTag}`);
    await input.press('Enter');

    await expect(input).toBeEditable({ timeout: 3_000 });
    await input.fill(`second question${secondTag}`);
    await input.press('Enter');

    // 两轮都必须落地。红态是第二问被 `ask()` 的 `if (pending) return` 静默吞掉：
    // 访客看到自己按了发送、框也清空了，然后什么都没发生。
    await expect(page.getByTestId('answer-body'), '排队的那一问也答了')
      .toHaveCount(2, { timeout: 40_000 });
    await expect(page.getByTestId('answer-body').last())
      .toContainText('The second answer', { timeout: 20_000 });
  });
});

async function enterChatWithCode(page: Page): Promise<void> {
  await enterCodeSession(page, CODE);
  await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request: APIRequestContext = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'receipt-seed');
  const sid = await initMCP(request, apiToken);
  await seedWiki(request, apiToken, sid, { title: 'Alpha', body: 'Alpha.', path: 'alpha' });
  const role = await createRole(request, csrf, {
    name: 'receipt-role', description: 'composer receipt spec',
    corpus_uris: ['wiki://**', 'output://**'], waypoints: [WP],
  });
  await createCode(request, csrf, { code: CODE, label: 'receipt', assumed_role_id: role.id });
  await request.dispose();
}
