// gas-public-spend-is-metered.spec.ts —— owner 的花销上限必须管得住匿名/public 访客。
//
// pentest 2026-09-01：一场没指定 provider 的会话（public / 匿名）在 turn 时**回落到 owner
// 默认那条 provider** 并真花钱。可它的会话里 provider_id 一直是空串，于是：
//   · 用量行记的 provider_id 是空的 → 按 provider 求和的 gas 记账数不到这笔花销；
//   · gas 闸的条件是 `metered && provider_id != ""` → 对 public 会话永不触发。
// 结果：owner 就算给默认那条配了油表，也拦不住匿名访客烧他的 key。
//
// 修复（会话签发时把空 provider 冻成 owner 默认那条的 id）后，这两条成立：
//   ① 一次 public turn 的用量行带上默认 provider 的 id（不再是空）；
//   ② 把 public role 挂表 + 默认 provider 只给几个 token，第二次 public turn 被油尽挡住。
//
// RED（修复前）：用量行 provider_id 为空；油尽闸对 public 不触发，第二次 turn 照样 200。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken, execSQL, querySQL } from '@/fixtures/instance';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'gasmeter@example.com', password: 'correct-horse-battery-staple',
  handle: 'gasmeter', fullName: 'Gas Meter Owner',
};

async function publicTurn(request: APIRequestContext, msg: string): Promise<number> {
  const sess = await issueSession(request, { handle: OWNER.handle, mode: 'public', visitor_name: 'V' });
  const tag = await scriptMockReplyText(request, 'A recap of what we discussed today.');
  const res = await request.post(`${BACKEND}/api/v1/agent/turn`, {
    headers: { Authorization: `Bearer ${sess.session_token}`, 'Content-Type': 'application/json' },
    data: { system: 'You are the owner.', user_message: `${msg}${tag}`, conversation_id: sess.conversation_id },
  });
  return res.status();
}

test.describe('gas · an anonymous/public visitor spends the owner default provider, and it is metered', () => {
  let request: APIRequestContext;

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password, handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await loginAPI(request, OWNER.email, OWNER.password);
  });
  test.afterAll(async () => { await request.dispose(); });

  test('a no-code turn attributes its usage to the default provider (not an empty provider_id)',
    async () => {
      expect(await publicTurn(request, 'hello '), 'public turn runs on the owner key').toBe(200);

      const defaultID = querySQL(`SELECT id FROM owner_providers WHERE is_default`);
      expect(defaultID, '前置：实例有一条默认 provider').not.toBe('');
      // 修复前这里是空串 —— 花的是默认 key 的钱，用量却不归属任何 provider。
      const attributed = querySQL(
        `SELECT provider_id FROM inference_usage ORDER BY created_at DESC LIMIT 1`,
      );
      expect(attributed,
        '匿名 turn 的用量必须记在它实际花掉的那条默认 provider 上，否则 gas 记账看不见它')
        .toBe(defaultID);
    });

  test('once the owner meters the public tier and the default tank runs low, a public turn is refused',
    async () => {
      // owner 的意图：给 public role 挂表，默认那条只剩 1 个 token。
      // 直接改库造前置状态（没有"把油放到几乎见底"的 API，也不该有）。
      //
      // gas=1 而不是几十：闸门是"写之前查，只要 Remaining>0 就放行"（最后一轮可超支 ——
      // 想不超一个 token 就得在答之前知道要花多少，不可能）。所以要让**下一次**被挡住，
      // 油必须小于**一次** turn 的花销。留 1，一次 turn 就把它打穿。
      execSQL(`UPDATE roles SET gas_metered = true WHERE name = 'public'`);
      execSQL(`UPDATE owner_providers SET gas_tokens = 1, gas_filled_at = now() WHERE is_default`);

      // 第一次 public turn 允许（油 > 0），一次就把 1 token 打穿（超支落库）。
      expect(await publicTurn(request, 'first '), '油还有时第一次放行').toBe(200);
      // 第二次必须被油尽挡住 —— 这正是修复前对 public 永不触发的那道闸。
      // gas_exhausted 走 403（不是限流的 429）：它不是"太频繁",是"这箱油空了"。
      const second = await publicTurn(request, 'second ');
      expect(second, '油尽后匿名 turn 必须被挡（403 gas_exhausted），否则 owner 的花销上限对 public 无效')
        .toBe(403);
    });
});
