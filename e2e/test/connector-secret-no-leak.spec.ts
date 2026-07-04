// connector-secret-no-leak.spec.ts —— Phase B / secret-scan：连接器凭据**永不**
// 出现在访客可见的产物里。约/列时段会经 GCal 连接器（持密代调），但 owner 的
// client_secret / token 这串值，绝不该出现在 tool_result 或 admin 会话 transcript。
//
// 这条配合 connector-credential-arch（go-arch-lint 结构门）从两侧夹「凭据永不出
// vault」：结构上 capability 碰不到凭据 + 行为上凭据不泄漏。重构前后都必须绿
// （是回归 guard，不是新 contract，所以现在就该是绿的）。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// gcal-setup 用 MOCK_GCAL_CREDS（client_secret 是已知常量）。这串值是 owner 的
// 凭据，绝不该泄漏到访客侧。
const GCAL_CLIENT_SECRET = 'mock-gcal-client-secret';

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

async function callListSlots(
  request: APIRequestContext, convID: string, token: string,
): Promise<{ status: number; text: string }> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${convID}/tools/calendar_list_slots`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        from_rfc3339: future(3, 13), until_rfc3339: future(5, 23),
        duration_min: 30, step_min: 60,
      },
    },
  );
  return { status: res.status(), text: await res.text() };
}

// fetchTranscript —— 读 owner admin 视角下该对话的完整 transcript(tool 调用 + 结果都持久化在
// 这里,secret 若泄漏会现形)。**必须用 owner-authed 的 seed.request**:访客 context 打 admin
// 路由只会 401,拿到的错误体天然不含 secret → not.toContain 恒真(假绿)。返 status 供断言把关。
async function fetchTranscript(
  ownerRequest: APIRequestContext, csrf: string, convID: string,
): Promise<{ status: number; text: string }> {
  const res = await ownerRequest.get(`${BACKEND}/api/admin/conversations/${convID}`, {
    headers: { 'X-Csrftoken': csrf },
  });
  return { status: res.status(), text: await res.text() };
}

test.describe('Phase B · connector credential never leaks to the visitor', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('calendar_list_slots goes through the GCal connector but never echoes the secret',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: seed.code.code, visitor_name: 'V',
      });

      // exercises the connector (FreeBusy via the stored token).
      const { status, text } = await callListSlots(request, sess.conversation_id, sess.session_token);
      expect(status).toBe(200);
      // the owner credential value must NOT appear in the visitor-facing tool result.
      expect(text, 'secret not in tool_result').not.toContain(GCAL_CLIENT_SECRET);

      // nor in the admin transcript of that conversation (tool calls + results are persisted).
      // 用 owner-authed 的 seed.request 真读回 transcript;先钉 200,别让 401 错误体把断言蒙混过关。
      const transcript = await fetchTranscript(seed.request, seed.csrf, sess.conversation_id);
      expect(transcript.status, 'transcript really fetched (not a 401 body)').toBe(200);
      expect(transcript.text, 'secret not in transcript').not.toContain(GCAL_CLIENT_SECRET);

      await request.dispose();
    });
});
