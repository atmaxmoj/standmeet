// chat-compaction-keeps-evidence.spec.ts —— F-D-10 后半：**压缩把这一轮的证据压没了，
// 于是答案变成一句填充语。**
//
// prod 上真出过（2026-08-17，真第三方 MCP）：两个工具跑完、回了 374871 + 3505 字节，紧接着
// 日志 `context compacted before_msgs:5 after_msgs:2`，然后 AI 整段只有
// *"I'm here — what would you like to dig into next?"* —— 问题没答。
//
// 机制读到了行：压缩收尾 `finalizeKeepingTail` → `tailPlainTurns` **故意跳过工具调用和工具
// 结果**（留下结果而调用没了，provider 会拒收整个请求）。所以工具痕迹在压缩里必然消失，
// **唯一能带走它的是那份摘要**；而摘要的任务书 `compactionUserInstruction` 五条全讲对话事实，
// 一个字没提工具返回了什么。
//
// **这条守卫只守「问对了」，守不到「答对了」**，而且这不是偷懒：替身不会真的做摘要（mock 对
// 没注册的请求是回声，回声里什么都在），所以「摘要保住了证据」在这一侧会**无条件为真** ——
// 那是假绿（[[stand-in-is-politer-than-reality]]）。结果那一半归 eval（真模型），见 findings。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { gatewayRequestExists, scriptMockReplyText, sendAndDrain } from '@/fixtures/mock-llm-script';
import { createRole } from '@/fixtures/roles';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'compaction@example.com', password: 'correct-horse-battery-staple',
  handle: 'compaction', fullName: 'Compaction Owner',
};
const CODE = 'COMPACT-001';

// COMPACTION_MARK —— 任务书自己的第一句，只有压缩那一次请求会带着它。命中 = 压缩真的发生过。
const COMPACTION_MARK = 'Condense the conversation so far';

// EVIDENCE_CLAUSE —— 任务书里**要工具返回的实质**那一条。这是本条守卫要的那句话。
const EVIDENCE_CLAUSE = 'What any tools returned';

test.describe.serial('F-D-10 · compaction is told to keep the evidence', () => {
  let request: APIRequestContext;
  let session: VisitorSession;

  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000);
    resetInstance();
    request = await playwright.request.newContext({ timeout: 30_000 });
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const role = await createRole(request, csrf, {
      name: 'compaction-role', description: 'compaction spec', corpus_uris: ['wiki://**'],
    });
    await createCode(request, csrf, {
      code: CODE, label: 'compaction', assumed_role_id: role.id, max_turns_per_session: 20,
    });
    session = await issueSession(request, {
      handle: OWNER.handle, code: CODE, visitor_name: 'Verbose Vera',
    });
  });

  test.afterAll(async () => { await request.dispose(); });

  test('the summariser is asked for what the tools returned', async () => {
    test.setTimeout(180_000);
    // 把上下文推过 32k：一封**访客真的会粘贴**的长文（一份职位描述 / 一段规格）。
    // 不是为了压垮谁 —— 这正是这个产品邀请的动作。
    const bulk = 'The role we are hiring for, described at length. '.repeat(3000);
    const first = await scriptMockReplyText(request, 'noted');
    await sendAndDrain(request, session, `${bulk}${first}`);

    const second = await scriptMockReplyText(request, 'still noted');
    await sendAndDrain(request, session, `So what do you make of it?${second}`);

    // 先证「压缩真的发生了」—— 否则下面那句是在一个从没跑过的分支上判空
    // （[[assertion-that-cannot-fail]]）。**按内容问，不按 tag**：压缩是它自己的一次调用，
    // 按 tag 会拿到那一轮自己的请求（我第一版就是这么红在查询上而不是产品上的）。
    await expect.poll(
      async () => gatewayRequestExists(request, COMPACTION_MARK),
      { timeout: 60_000, message: 'compaction ran at all' },
    ).toBe(true);

    expect(
      await gatewayRequestExists(request, EVIDENCE_CLAUSE),
      'the summariser is told to carry the tool results forward — the tool trace itself cannot '
      + 'survive compaction, so that summary is the only place the evidence can live, and a turn '
      + 'that loses it answers "what would you like to dig into next?" instead of the question',
    ).toBe(true);
  });
});
