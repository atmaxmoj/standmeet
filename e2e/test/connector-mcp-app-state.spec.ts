// connector-mcp-app-state.spec.ts —— MCP App 跨刷新状态原语 + 隔离（§一 外置）。
//
// 沙箱卡（ui:// iframe）是「能跨刷新存活的小应用」：它经 host 对**自己 mcp 那一格**做
// 增删改查。状态挂在 session 背后的耐久身份（member）上，按 mcp 分格：
//     state[member][mcp_id][key] = value
// mcp_id **由后端从 {tool} 推出**（capreg tool→plugin），绝不收客户端传来的 mcp_id —— 这
// 是隔离的根：卡只能碰自己 tool 所属 mcp 那一格。
//
// 证明：
//   1. CRUD：set → get → delete 按 (member, mcp, key) round-trip。
//   2. 同一 mcp 跨 session 隔离：member A 的 booker-state 看不到 member B 的。
//   3. 同一 session 跨 mcp 隔离：booker 那格 ≠ retrieval 那格，互不串。
//   4. mcp-keyed（forge 不了）：同属 booker 的 calendar_book / calendar_list_slots 共享
//      一格 —— 证明按 mcp 派生、非按 tool 字面，客户端给不同 tool 名也落同一 mcp。
//
// RED until: 后端落 mcp_app_state 表 + /sessions/{conv}/app-state/{tool}[/{key}] endpoint
// （member × mcp scope，mcp 从 tool 派生）。

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { issueSession } from '@/fixtures/visitor';
import { putAppState, getAppState, deleteAppState } from '@/fixtures/app-state';

test.describe('MCP App 跨刷新状态原语 + 隔离', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book', 'corpus.retrieval'],
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('CRUD: set → get → delete 按 (member, mcp, key) round-trip', async () => {
    const { request } = seed;
    const { session_token: tok, conversation_id: conv } = seed.visitor;
    expect(await putAppState(request, tok, conv, 'calendar_book', 'evt1', { cancelled: true })).toBe(200);
    expect(await getAppState(request, tok, conv, 'calendar_book'))
      .toMatchObject({ evt1: { cancelled: true } });
    expect(await deleteAppState(request, tok, conv, 'calendar_book', 'evt1')).toBe(200);
    expect(await getAppState(request, tok, conv, 'calendar_book')).toEqual({});
  });

  test('同一 mcp 跨 session 隔离: member A 的 booker-state ≠ member B 的', async () => {
    const { request } = seed;
    const a = seed.visitor;
    const b = await issueSession(request, {
      handle: OWNER.handle, mode: 'code', code: seed.code.code,
      visitor_name: 'Visitor B', visitor_email: 'b@example.com',
    });
    await putAppState(request, a.session_token, a.conversation_id, 'calendar_book', 'xs', { who: 'A' });
    await putAppState(request, b.session_token, b.conversation_id, 'calendar_book', 'xs', { who: 'B' });
    expect(await getAppState(request, a.session_token, a.conversation_id, 'calendar_book'))
      .toMatchObject({ xs: { who: 'A' } });
    expect(await getAppState(request, b.session_token, b.conversation_id, 'calendar_book'))
      .toMatchObject({ xs: { who: 'B' } });
  });

  test('同一 session 跨 mcp 隔离: booker 那格 ≠ retrieval 那格', async () => {
    const { request } = seed;
    const { session_token: tok, conversation_id: conv } = seed.visitor;
    await putAppState(request, tok, conv, 'calendar_book', 'xm', { mcp: 'booker' });
    await putAppState(request, tok, conv, 'corpus_search', 'xm', { mcp: 'retrieval' });
    const booker = await getAppState(request, tok, conv, 'calendar_book');
    const retrieval = await getAppState(request, tok, conv, 'corpus_search');
    expect((booker['xm'] as { mcp: string }).mcp).toBe('booker');
    expect((retrieval['xm'] as { mcp: string }).mcp).toBe('retrieval');
  });

  test('mcp-keyed（同 mcp 多 tool 共享一格）: calendar_book 写的，calendar_list_slots 读得到', async () => {
    const { request } = seed;
    const { session_token: tok, conversation_id: conv } = seed.visitor;
    await putAppState(request, tok, conv, 'calendar_book', 'shared', { v: 1 });
    // 同属 booker mcp → 另一个 tool 名读同一格（证明按 mcp 派生、非按 tool 字面）。
    expect(await getAppState(request, tok, conv, 'calendar_list_slots'))
      .toMatchObject({ shared: { v: 1 } });
  });
});
