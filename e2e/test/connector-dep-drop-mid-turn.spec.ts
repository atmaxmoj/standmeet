// connector-dep-drop-mid-turn.spec.ts —— 状态变更矩阵
// 「已连→断联 · mid-call(已发 tool 列表、调时已断) · 友好降级,无 500/stack」补
// (亦对应错误流矩阵 E7 token refresh 失败一类的「调用瞬间连接掉」)。
//
// 与 connector-revoked-degrades 同形:装配时已连(tool 进了发给 LLM 的列表),但
// 真正执行 calendar_book 前连接掉了 —— 这里用 revokeMockGCalToken 让该 call 的
// token 刷新撞 invalid_grant。期望:tool call **友好降级**(提示重连日历),
// 绝不 500,不漏 stack / panic / invalid_grant 原文。
//
// RED:重构落地前 connector-backed tool 的错误映射/降级路径若未统一收口,
// 可能直接 500 或把 provider 原始错误透出 → 断言失败,符合 TDD 预期。

import { execSync } from 'node:child_process';
import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { revokeMockGCalToken } from '@/fixtures/gcal';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const DB_CONTAINER = 'standmeet-dev-db-1';

interface ToolResp {
  ok: boolean;
  reason?: string;
  result?: { error?: string };
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

// expireAccessToken —— 标记 owner GCal access_token 过期,逼 book 走刷新路径
// (刷新撞上已 revoke 的 token 端点)。
function expireAccessToken(): void {
  const sql = `UPDATE owner_calendar_connectors
              SET access_token_expires_at = NOW() - INTERVAL '1 hour'
              WHERE provider = 'google'`;
  execSync(`docker exec ${DB_CONTAINER} psql -U standmeet -d standmeet -c "${sql}"`,
    { stdio: 'pipe' });
}

async function callBook(
  request: APIRequestContext, convID: string, token: string,
): Promise<{ status: number; body: ToolResp }> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${convID}/tools/calendar_book`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: { topic: 'Mid-turn drop test', duration_min: 30, preferred_times: [future(7, 14)] },
    },
  );
  return { status: res.status(), body: await res.json() as ToolResp };
}

test.describe('connector dep · connection drops mid-turn → friendly degrade', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('tool was exposed at assembly but connection drops before the book call → no 500, no leak',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();

      // 装配时仍已连 → 该回合 tool 进列表。随后连接在调用前掉(revoke + 逼刷新)。
      await revokeMockGCalToken(request);
      expireAccessToken();

      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code: seed.code.code,
        visitor_name: 'Recruiter Rachel', visitor_email: 'rachel@example.com',
      });
      const { status, body } = await callBook(request, sess.conversation_id, sess.session_token);

      // 友好降级:不是 500,给人话提示(重连日历),不漏底层细节。
      expect(status, 'no server crash').toBeLessThan(500);
      const msg = `${body.reason ?? ''} ${body.result?.error ?? ''}`;
      expect(msg, 'friendly reconnect hint')
        .toMatch(/calendar|reconnect|disconnect|unavailable/i);
      expect(msg, 'no raw stack / leak')
        .not.toMatch(/panic|goroutine|stack|invalid_grant/i);

      await request.dispose();
    });
});
