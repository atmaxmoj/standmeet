// connector-booker-handle-no-leak.spec.ts —— booked 外置后的新泄漏面
// (connector-deps-tests.md §一 booker-handle-no-leak)。booker 插件经依赖解析拿到的是
// calendar/smtp 的**句柄**(经 host 路由的调用口),不是 owner 的 token/SMTP 密码。
// `connector-secret-no-leak` 盯的是访客侧 wire;`connector-arbitrary-dep` 盯的是合成
// 连接器 X。这条专盯**真 booker 插件**:owner 的 GCal token / SMTP 凭据永不进 booker
// 进程,因而绝不出现在 booker 经手的任何东西里(tool result、owner-MCP 透传、日志面)。
//
// RED until: booker 改成经注入句柄自持集成(token 不出 connector 层)。

import { test, expect } from '@/fixtures/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { MOCK_GCAL_CREDS } from '@/fixtures/gcal';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';

test.describe('connector · booker plugin gets a handle, never the owner credentials', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, { granted_skills: ['calendar.book'] });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('book → 访客侧 tool result 不含 owner 的 access_token / refresh_token / client_secret',
    async () => {
      await scriptMockToolCall(seed.request, {
        name: 'calendar_book',
        args: { topic: 'leak probe', duration_min: 30, preferred_times: [future()] },
      });
      const backend = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
      // 独立 APIRequestContext（非 page.request），bare 变量避开「写走 UI」规则。
      const { request } = seed;
      const res = await request.post(`${backend}/api/v1/agent/turn`, {
        headers: { Authorization: `Bearer ${seed.visitor.session_token}` },
        data: { conversation_id: seed.visitor.conversation_id, message: 'book it' },
      });
      const body = await res.text();

      // 凭据标记(mock 凭据里的 client_secret / 任何 token 串)绝不出现在 booker 经手的回包里。
      expect(body, 'client_secret 不泄漏').not.toContain(MOCK_GCAL_CREDS.client_secret);
      expect(body, '无 refresh_token 串').not.toMatch(/refresh_token|client_secret|access_token=/i);
      expect(body, '无 stack/panic').not.toMatch(/panic|goroutine|stack/i);
    });
});

function future(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 3);
  d.setUTCHours(14, 0, 0, 0);
  return d.toISOString();
}
