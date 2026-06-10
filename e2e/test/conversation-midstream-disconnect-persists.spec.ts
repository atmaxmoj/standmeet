// conversation-midstream-disconnect-persists.spec.ts —— #28: 后端拥有这一轮。
//
// 业务属性:访客问一句,答到一半连接断了(刷新 / 关页 / 网络掉)。这一轮的
// 真正主体在后端 —— agent 事件流末端 sink 进 conversation 表,**不依赖客户端
// 在场**。所以即使客户端中途消失,后端照样把这轮跑完 + 落库;之后重新读
// conversation,这轮在、答案完整、count +1。
//
// 跟 conversation-*-survive-reload.spec.ts 互补:那些测「已落库的历史刷新后
// 还在」;这条测「答到一半断开,那一轮照样落得了库」—— 即后端 sink 不靠前端。
//
// 断流仿真:给一个慢答(user_message 里嵌 [[think:N]] 让 mock 出答案前 sleep
// N ms),POST /agent/turn 设一个比 N 短的 timeout → Playwright 中途 abort 这条
// 请求(= 客户端断开)。然后轮询 GET /conversations/{id} 直到这轮出现。
//
// 修复前(loop 绑 r.Context() + 不落库):客户端 abort → ctx 取消 → loop 当场死、
// 没人落库 → 轮询超时 → 失败。修复后(detached ctx + 流末端 DB sink):abort 不影响
// loop,mock sleep 完出答案,后端累计 + sink 进 DB → 轮询见到这轮。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';
import type { Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';
import type { VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'midstream@example.com', password: 'correct-horse-battery-staple',
  handle: 'midstream', fullName: 'Midstream Owner',
};

const CODE = 'MIDSTREAM-001';

// THINK_MS —— mock 出最终答案前 sleep 这么久。DISCONNECT_MS < THINK_MS,
// 让客户端在答案还没流出来时就断开,坐实「答到一半连接没了」。
const THINK_MS = 3000;
const DISCONNECT_MS = 1000;

const ANSWER = 'I have been wiring the deterministic state holder all week.';

async function setupOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const role = await createRole(request, csrf, {
    name: 'midstream-role', description: 'midstream spec',
    corpus_uris: ['wiki://**', 'output://**'],
  });
  await createCode(request, csrf, {
    code: CODE, label: 'midstream', assumed_role_id: role.id,
  });
  await request.dispose();
}

interface ConvDialog { question: string; answer: string }

async function fetchDialogs(
  request: APIRequestContext, sess: VisitorSession,
): Promise<ConvDialog[]> {
  const res = await request.get(
    `${BACKEND}/api/v1/conversations/${sess.conversation_id}`,
    { headers: { Authorization: `Bearer ${sess.session_token}` } },
  );
  if (res.status() !== 200) return [];
  const body = await res.json() as { conversation?: { dialogs?: ConvDialog[] } };
  return body.conversation?.dialogs ?? [];
}

// disconnectMidStream —— POST /agent/turn 但只给 DISCONNECT_MS 就 abort,
// 模拟客户端答到一半离开。Playwright timeout 会 reject + 关连接;这里吞掉
// 那个 reject(本来就是要它断)。
async function disconnectMidStream(
  request: APIRequestContext, sess: VisitorSession, userMessage: string,
): Promise<void> {
  try {
    await request.post(`${BACKEND}/api/v1/agent/turn`, {
      headers: {
        Authorization: `Bearer ${sess.session_token}`,
        'Content-Type': 'application/json',
      },
      data: {
        system: 'You are alice.', user_message: userMessage,
        conversation_id: sess.conversation_id,
      },
      timeout: DISCONNECT_MS,
    });
    throw new Error('expected the mid-stream request to be aborted, but it returned');
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('expected the mid-stream')) throw e;
    // Playwright TimeoutError —— 预期内,客户端断开。
  }
}

test.describe('conversation · mid-stream disconnect 后端照样落库', () => {
  test.beforeAll(async ({ playwright }) => {
    await setupOwner(playwright);
  });

  test('答到一半断开 → 后端跑完 + sink 进 conversation', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const sess = await issueSession(request, {
      handle: OWNER.handle, code: CODE, visitor_name: 'V',
    });

    await scriptMockReplyText(request, ANSWER);
    const userMessage = `what are you working on [[think:${THINK_MS}]]`;
    await disconnectMidStream(request, sess, userMessage);

    // 客户端已经走了。后端在 detached ctx 上把这轮跑完 + 落库;轮询直到这轮出现。
    await expect.poll(
      async () => (await fetchDialogs(request, sess)).length,
      { timeout: 15_000, intervals: [300, 500, 800] },
    ).toBe(1);

    const dialogs = await fetchDialogs(request, sess);
    expect(dialogs[0]?.answer).toContain(ANSWER);
    expect(dialogs[0]?.question).toBe(userMessage);

    await request.dispose();
  });
});
