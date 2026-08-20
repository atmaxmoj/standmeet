// connector-refresh-keeps-scopes.spec.ts —— F-C-43：**一次静默刷新不许把已授范围抹掉。**
//
// 为什么现在才要紧：F-B-8 之后，连接行上的 `scopes` 是**载荷**了 —— 装配时拿它跟每个动作
// 需要的 scope 对照，够不着就把那把工具摘掉。于是「刷新之后 scopes 变成空」不再是一行脏
// 数据，而是**owner 连上一小时后，访客那边订会静默消失**，卡上还写着 `connected`。
//
// 复现条件是规范里明写的：RFC 6749 §5.1 —— token 响应里的 `scope` 在「范围跟请求的一样」时
// **可以省略**。Google 会回显，所以真环境上这条路走不到；替身以前也总是回显，比规范客气，
// 产品因此从没被问过「省略时你把已授范围当成什么」（[[stand-in-is-politer-than-reality]]）。
// 先教替身守规矩（`?outcome=refresh_omit_scope`），再让守卫红，最后改产品。
//
// 判据不是「scopes 非空」而是「**跟刷新前逐字相同**」：前者在产品把它换成一个别的常量时
// 照样绿。而末尾那句「工具还在」才是这条缺陷真正伤到的东西 —— 数据对了但能力没回来的话，
// 前面两句都白绿。

import { execSync } from 'node:child_process';
import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { sessionToolNames } from '@/fixtures/capabilities';
import { grantedScopes } from '@/fixtures/gcal';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall, sendAndDrain } from '@/fixtures/mock-llm-script';

const MOCK = process.env['MOCK_BASE_URL'] ?? 'http://localhost:9000';
const DB_CONTAINER = 'standmeet-dev-db-1';

test.describe('F-C-43 · a silent refresh keeps the granted scopes', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
    });
  });
  test.afterAll(async () => {
    await programOAuth(seed.request, '');
    await teardownSeed(seed);
  });

  test('the provider omits scope on refresh; the connection keeps what it was granted',
    async () => {
      test.setTimeout(120_000);
      const before = await grantedScopes(seed.request);
      expect(before.length,
        'the seed must start with a real grant, or this test proves nothing')
        .toBeGreaterThan(0);

      await programOAuth(seed.request, 'refresh_omit_scope');
      expireAccessToken();

      // 走一次真的要用日历的调用，刷新才会发生 —— 这正是 owner 眼里「什么都没做」的那一刻。
      const tag = await scriptMockToolCall(seed.request, {
        name: 'calendar_book',
        args: { topic: 'Scope survival', duration_min: 30, preferred_times: [future(7, 14)] },
      });
      await sendAndDrain(seed.request, seed.visitor, `Book${tag}`);

      const after = await grantedScopes(seed.request);
      expect(after,
        'a refresh that says nothing about scope is not a refresh that revoked it')
        .toEqual(before);

      const tools = await sessionToolNames(seed.request, seed.visitor.session_token);
      expect(tools,
        'and the visitor still gets booking — losing it here would be invisible to the owner')
        .toContain('calendar_book');
    });
});

async function programOAuth(request: APIRequestContext, outcome: string): Promise<void> {
  const res = await request.get(`${MOCK}/__mock/oauth/program?outcome=${outcome}`);
  if (res.status() !== 200) throw new Error(`program oauth: ${res.status()}`);
}

// expireAccessToken —— 把 access token 的过期时间推到过去，下一次要用日历的调用就会静默刷新。
// 跟 chat-book-token-refresh 用的是同一把旋钮（后端没有 dev-only 的时钟端点）。
function expireAccessToken(): void {
  const sql = `UPDATE owner_connectors
              SET token_expires_at = NOW() - INTERVAL '1 hour'
              WHERE connector_id = 'google-calendar'`;
  execSync(
    `docker exec ${DB_CONTAINER} psql -U standmeet -d standmeet -c "${sql}"`,
    { stdio: 'pipe' },
  );
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
