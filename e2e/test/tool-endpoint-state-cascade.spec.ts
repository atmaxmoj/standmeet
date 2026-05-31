// tool-endpoint-state-cascade.spec.ts —— 横切 invariant：per-tool
// 端点 response 里的 capability_state 永远是**当前** Registry-evaluated
// 状态，跟"哪个 tool 被调"无关。
//
// 关键场景：calendar_book 调一次 (burn quota) 后，下次随便调任何 tool
// (e.g. corpus_search)，capability_state 里 calendar.book 应已经
// gated out (max_bookings 满 → ErrHidden)。前端 zustand 用任意 tool
// response 同步，pi-agent-core 再装配 system 时 calendar_book 不再可见
// → "拒了返新 state → 前端 zustand 强制同步 → pi 重装配 tool" 不变量
// 兑现。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import type { SessionCapability, VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

interface ToolResp {
  ok: boolean;
  reason?: string;
  result?: unknown;
  capability_state?: SessionCapability[];
}

async function callTool(
  request: APIRequestContext, sess: VisitorSession,
  toolName: string, args: object,
): Promise<{ status: number; body: ToolResp }> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${sess.conversation_id}/tools/${toolName}`,
    {
      headers: { Authorization: `Bearer ${sess.session_token}` },
      data: args,
    },
  );
  const status = res.status();
  const body = await res.json() as ToolResp;
  return { status, body };
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

function findCap(caps: SessionCapability[] | undefined, id: string): SessionCapability | undefined {
  return caps?.find(c => c.id === id);
}

test.describe('tool endpoint · capability_state cascade is cross-tool', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
      max_bookings: 1,
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('before burn: corpus_search response shows calendar.book enabled + quota_remaining=1',
    async () => {
      const { status, body } = await callTool(
        seed.request, seed.visitor, 'corpus_search', { query: 'anything' },
      );
      expect(status).toBe(200);
      const cal = findCap(body.capability_state, 'calendar.book');
      expect(cal, 'calendar.book visible before burn').toBeDefined();
      expect(cal?.enabled).toBe(true);
      expect(cal?.quota_remaining).toBe(1);
    });

  test('burn calendar_book (max_bookings=1) → cap immediately gated out in same response',
    async () => {
      const { status, body } = await callTool(
        seed.request, seed.visitor, 'calendar_book', {
          topic: 'Only allowed slot',
          duration_min: 30,
          preferred_times: [future(7, 14)],
        },
      );
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      // Handler 跑 executor 后**重新**装配拿 fresh cap state；
      // booking 已经落库 (count=1==max)，gating 立刻把 calendar.book
      // 隐藏。response 里 cap 应当 absent — 这是 cascade 的核心：
      // tool 自己执行触发的状态变化在同一 response 里就被前端看到。
      expect(
        findCap(body.capability_state, 'calendar.book'),
        'calendar.book gated out immediately after the burn call',
      ).toBeUndefined();
    });

  test('after burn: corpus_search response shows calendar.book gated out (cross-tool invariant)',
    async () => {
      const { status, body } = await callTool(
        seed.request, seed.visitor, 'corpus_search', { query: 'anything' },
      );
      expect(status).toBe(200);
      expect(
        findCap(body.capability_state, 'calendar.book'),
        'calendar.book absent from any tool response after quota exhausted',
      ).toBeUndefined();
      // corpus.retrieval 不受影响
      expect(
        findCap(body.capability_state, 'corpus.retrieval')?.enabled,
      ).toBe(true);
    });

  test('after burn: re-calling calendar_book → 404 + capability_state still excludes it',
    async () => {
      const { status, body } = await callTool(
        seed.request, seed.visitor, 'calendar_book', {
          topic: 'Tries again',
          duration_min: 30,
          preferred_times: [future(8, 14)],
        },
      );
      expect(status).toBe(404);
      expect(body.reason).toBe('capability_not_enabled');
      expect(
        findCap(body.capability_state, 'calendar.book'),
        'still absent from cap state after a denied call',
      ).toBeUndefined();
    });
});
