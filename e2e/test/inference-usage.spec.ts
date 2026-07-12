// inference-usage.spec.ts —— #106 inference 计费:每次 owner-key LLM 调用记 {model,
// input/output tokens} 进 inference_usage 表(7 天窗口);admin GET /inference-usage 出近 7 天
// 按天×model 聚合。BYOAI 是访客自付,不计 owner。
//
// 红(实现前):端点 404、无记录。绿(实现后):owner-key turn 后出现带 token 的用量行。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'usage-owner@example.com', password: 'correct-horse-battery-staple',
  handle: 'usageowner', fullName: 'Usage Owner',
};
const CODE = 'USE-001';

interface UsageRow {
  date: string;
  model: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
}
interface UsageResp {
  rows: UsageRow[];
  total: { calls: number; input_tokens: number; output_tokens: number };
}

test.describe('inference usage billing · #106', () => {
  let csrf = '';
  let request: APIRequestContext;

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    csrf = (await loginAPI(request, OWNER.email, OWNER.password)).csrf;
    const role = await createRole(request, csrf, {
      name: 'usage-role', description: 'usage', corpus_uris: ['wiki://**'],
    });
    await createCode(request, csrf, { code: CODE, label: 'usage', assumed_role_id: role.id });
  });

  test.afterAll(async () => { await request.dispose(); });

  test('owner-key agent turn records token usage → admin 7-day summary shows it',
    async () => {
      // 起初 7 天用量为空。
      const before = await getUsage(request);
      expect(before.total.calls, 'no usage before any turn').toBe(0);

      // 一次 owner-key 访客 turn → 走 mock LLM(发 usage 帧)。
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'V',
      });
      const tag = await scriptMockReplyText(request, 'Sure, here is a recap of what we discussed.');
      const turn = await request.post(`${BACKEND}/api/v1/agent/turn`, {
        headers: { Authorization: `Bearer ${sess.session_token}`, 'Content-Type': 'application/json' },
        data: { system: 'You are alice.', user_message: `hi${tag}`, conversation_id: sess.conversation_id },
      });
      expect(turn.status(), 'turn ok').toBe(200);

      // admin 用量端点:近 7 天出现这次调用,带 token。
      const after = await getUsage(request);
      expect(after.total.calls, 'the owner-key turn was billed').toBeGreaterThanOrEqual(1);
      expect(after.total.input_tokens, 'input tokens recorded').toBeGreaterThanOrEqual(1);
      expect(after.total.output_tokens, 'output tokens recorded').toBeGreaterThanOrEqual(1);
      expect(after.rows.length, 'at least one day×model row').toBeGreaterThanOrEqual(1);
      expect(after.rows[0]?.model, 'row carries the model').toBeTruthy();
    });
});

async function getUsage(request: APIRequestContext): Promise<UsageResp> {
  const res = await request.get(`${BACKEND}/api/admin/inference-usage`);
  expect(res.status(), 'inference-usage endpoint 200').toBe(200);
  return await res.json() as UsageResp;
}
