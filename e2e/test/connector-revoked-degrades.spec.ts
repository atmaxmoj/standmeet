// connector-revoked-degrades.spec.ts —— Phase B：连接器被撤销（owner 在 Google
// 端撤了授权）→ 下一次刷新拿到 invalid_grant → 后端识别为「连接器已失效」并
// **友好降级**，不崩、不露 stack trace。chat-book-token-refresh 覆盖「过期→刷新
// 成功」这半；这条补「刷新失败（revoked）→ 降级」那半。
//
// 触发：revoke mock token 端点 + 把 access_token 标记过期（强制走刷新路径）→
// 刷新被拒 → 访客约会拿到友好错误（提示重新连接日历），HTTP 不是 500。

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

// expireAccessToken —— 标记 owner 的 GCal access_token 过期，逼下一次 book 走
// 刷新路径（刷新会撞上已 revoke 的 token 端点）。
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
      data: { topic: 'Revoked test', duration_min: 30, preferred_times: [future(7, 14)] },
    },
  );
  return { status: res.status(), body: await res.json() as ToolResp };
}

test.describe('Phase B · revoked connector degrades gracefully', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('refresh hits invalid_grant → booking returns a friendly error, never a 500',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await revokeMockGCalToken(request);   // next refresh → invalid_grant
      expireAccessToken();                  // force the refresh path

      const sess = await issueSession(request, {
        handle: OWNER.handle, code: seed.code.code, visitor_name: 'V',
      });
      const { status, body } = await callBook(request, sess.conversation_id, sess.session_token);

      // graceful: not a 500, and the visitor gets a human-readable hint, not a stack trace.
      expect(status, 'no server crash').toBeLessThan(500);
      const msg = `${body.reason ?? ''} ${body.result?.error ?? ''}`;
      expect(msg, 'friendly reconnect hint').toMatch(/calendar|reconnect|disconnect|unavailable/i);
      expect(msg, 'no raw stack trace').not.toMatch(/panic|goroutine|invalid_grant/i);

      await request.dispose();
    });
});
