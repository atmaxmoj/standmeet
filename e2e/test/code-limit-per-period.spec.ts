// code-limit-per-period.spec.ts —— 一张码每个周期能花多少（可再生的速率闸）。
//
// 背景（2026-09-01 规划）：embed widget 跑在公开站上,很多访客共用同一张码。已有的两个上限
// 都不够：max_turns_per_session 是**每场**（一个访客开新会话就重置）,gas 是**总量**（花完要
// owner 手动续）。缺的是一个**每周期、自动再生**的桶 —— "这张码每小时至多 N 轮 / N gas",
// 到点自动回满。没有它,一张公开 embed 码会被一整天不停地薅。
//
// 契约（实现后成立）：码设了 limit_per_period={amount, unit, period_seconds} →
//   · 窗口内累计（**跨这张码的所有会话**,不是每场）到 amount 之前放行；
//   · 到了就拒（403 period_limit_reached），直到窗口滚过去再放行。
// 桶是**按码**的：embed 限的是这张码每周期的总量,跟哪个访客、哪场会话无关。
//
// 这条用 turns 计（比 gas 好数）。窗口用滚动式：数这张码在过去 period_seconds 内的轮数。
// RED（实现前）：没有这个闸 → 第三轮照样 200。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'periodlimit@example.com', password: 'correct-horse-battery-staple',
  handle: 'periodlimit', fullName: 'Period Limit Owner',
};
const CODE = 'RATE-2PH'; // 2 turns per hour

async function createCodeRaw(
  request: APIRequestContext, csrf: string, body: Record<string, unknown>,
): Promise<void> {
  const res = await request.post(`${BACKEND}/api/admin/codes`, {
    headers: { 'X-Csrftoken': csrf }, data: body,
  });
  if (res.status() !== 201) throw new Error(`create code: ${res.status()}`);
}

// runTurn —— 拿这张码开一场会话跑一轮，返回 HTTP 状态。每次新会话:证明桶是按码不是按场。
async function runTurn(request: APIRequestContext, msg: string): Promise<number> {
  const sess = await issueSession(request, { handle: OWNER.handle, code: CODE, visitor_name: 'V' });
  const tag = await scriptMockReplyText(request, 'A short reply.');
  const res = await request.post(`${BACKEND}/api/v1/agent/turn`, {
    headers: { Authorization: `Bearer ${sess.session_token}`, 'Content-Type': 'application/json' },
    data: { system: 'You are the owner.', user_message: `${msg}${tag}`, conversation_id: sess.conversation_id },
  });
  return res.status();
}

test.describe('code · a per-period limit caps the code across all its sessions', () => {
  let request: APIRequestContext;

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const role = await createRole(request, csrf, {
      name: 'rate-role', description: 'wiki://**', corpus_uris: ['wiki://**'],
    });
    await createCodeRaw(request, csrf, {
      code: CODE, label: 'rate', assumed_role_id: role.id,
      limit_per_period: { amount: 2, unit: 'turns', period_seconds: 3600 },
    });
  });
  test.afterAll(async () => { await request.dispose(); });

  test('the first N turns within the period are allowed, the N+1th is refused',
    async () => {
      // 每次都是**新会话**,共用这张码的周期桶。
      expect(await runTurn(request, 'one '), '窗口内第 1 轮放行').toBe(200);
      expect(await runTurn(request, 'two '), '窗口内第 2 轮放行').toBe(200);
      // 第 3 轮：这张码这个小时的额度用完 → 拒。max_turns_per_session 拦不住(每场都是新会话)。
      expect(await runTurn(request, 'three '),
        '同一张码窗口内第 3 轮必须被拒 —— 否则公开 embed 码会被不停地薅').toBe(403);
    });
});
