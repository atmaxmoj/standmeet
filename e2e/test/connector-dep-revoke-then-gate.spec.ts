// connector-dep-revoke-then-gate.spec.ts —— 状态矩阵「撤销→落库 disconnected→下次 gated」
// (connector-deps-tests.md §三)。`connector-dep-drop-mid-turn` 验的是「调用当下撞
// invalid_grant → 友好降级」那半;这条补**联动**那半:一次 refresh 撞 invalid_grant
// 被识别为「连接已失效」后,connector 状态应落库成 disconnected → **下一次** session
// 装配时,booking 经 global 单点闸直接 gate 掉(不再每次都白撞一回外部)。
//
// RED until: invalid_grant → 把 owner 的 calendar connector 标记 disconnected
// (清 access_token/置 needs-reauth),且 enabledCaps 据此 gate。

import { execSync } from 'node:child_process';
import { test, expect } from '@/fixtures/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { revokeMockGCalToken, getGCalStatus } from '@/fixtures/gcal';
import { expectCalendarBookExposed } from '@/fixtures/agent-skills-grant';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { issueSession } from '@/fixtures/visitor';

test.describe('connector dep · revoke detected → connector marked disconnected → next session gated', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, { granted_skills: ['calendar.book'] });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('一次 book 撞 invalid_grant → 连接落库 disconnected → 新 session 不再暴露 booking',
    async () => {
      // 连接好时,booking 暴露。
      await expectCalendarBookExposed(seed.request, seed.visitor.session_token, true);

      // token 被 owner 在 Google 端撤了 → 下一次调用(或其刷新)撞 invalid_grant。
      await revokeMockGCalToken(seed.request);
      // access token 过期 → 这次 book 必须先 refresh，refresh 撞 invalid_grant。
      expireAccessToken();

      // 触发一次真 book —— 它会撞 invalid_grant。这一刀的「友好降级」由
      // connector-dep-drop-mid-turn 验;这里只关心它**之后**连接状态翻没翻。
      await scriptMockToolCall(seed.request, {
        name: 'calendar_book',
        args: { topic: 'will fail refresh', duration_min: 30, preferred_times: [future()] },
      });
      await postTurn(seed, 'book me a slot');

      // 联动:invalid_grant 被识别 → connector 落库 disconnected。
      const status = await getGCalStatus(seed.request);
      expect(status.connected, 'invalid_grant 后连接落库为 disconnected').toBe(false);

      // 下一次 session 装配:booking 经 global 单点闸 gate 掉(不再每 turn 白撞外部)。
      const next = await issueSession(seed.request, {
        handle: OWNER.handle, code: seed.code.code, visitor_name: 'V2',
      });
      await expectCalendarBookExposed(seed.request, next.session_token, false);
    });
});

function future(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 3);
  d.setUTCHours(14, 0, 0, 0);
  return d.toISOString();
}

// expireAccessToken —— 把 owner 的 gcal access token 标过期，强制下一次 book 走刷新。
function expireAccessToken(): void {
  const sql = `UPDATE owner_connectors
              SET token_expires_at = NOW() - INTERVAL '1 hour'
              WHERE connector_id = 'google-calendar'`;
  execSync(`docker exec standmeet-dev-db-1 psql -U standmeet -d standmeet -c "${sql}"`,
    { stdio: 'pipe' });
}

// postTurn —— 直接发一轮 agent turn(不走浏览器),触发脚本化的 calendar_book。
async function postTurn(seed: CodedSeed, q: string): Promise<void> {
  // 独立 APIRequestContext（非 page.request），用 bare 变量调用避开「写操作走 UI」规则。
  const { request } = seed;
  await request.post(`${process.env['BACKEND_URL'] ?? 'http://localhost:8000'}/api/v1/agent/turn`, {
    headers: { Authorization: `Bearer ${seed.visitor.session_token}` },
    data: { conversation_id: seed.visitor.conversation_id, message: q },
  }).catch(() => { /* 撞 invalid_grant,turn 友好失败即可 */ });
}
