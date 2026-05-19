// turn-quota.spec.ts —— code 设 max_turns_per_session=2，访客发完 2 条后
// 第 3 条 chat message 被 403 turn_quota_reached。
//
// 用户故事：
//   面试官想限定每轮面试最多 2 次回合。code 配额生效后，访客第 3 次
//   POST /messages 就拿不到回复 —— 不应该静默 stream 错误，得是清晰 403
//   配合 error code，前端可以触发 toast。

import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { issueSession, sendMessage } from '@/fixtures/visitor';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const CODE = 'INTERVIEW-T2';
const MAX_TURNS = 2;

test.describe.serial('per-session turn quota stops chat after N turns', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await issueCodeWithTurnLimit(request);
    await request.dispose();
  });

  test('first 2 messages 200, 3rd 403 turn_quota_reached', async ({ request }) => {
    const sess = await issueSession(request, {
      handle: OWNER.handle, code: CODE, visitor_name: 'Eve',
    });
    for (let i = 0; i < MAX_TURNS; i++) {
      const res = await sendMessage(request, sess, `turn ${i + 1}`);
      expect(res.status()).toBe(200);
      // SSE response —— 消费掉避免 socket 悬挂
      await res.body();
    }
    const blocked = await sendMessage(request, sess, 'turn 3 — over quota');
    expect(blocked.status()).toBe(403);
    const body = await blocked.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe('turn_quota_reached');
  });
});

async function issueCodeWithTurnLimit(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await createAPIToken(request, csrf, 'noop-token');
  await createCode(request, csrf, {
    code: CODE,
    label: 'Interview round T — 2 turns max',
    purpose: 'turn-quota spec',
    included_tags: [],
    max_turns_per_session: MAX_TURNS,
  });
}
