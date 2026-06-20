// norm-inward-capabilities.spec.ts —— 【对内 / inward】能力黄金快照(归一化安全网)。
//
// 对内能力 = 装载进 agent、给**访客 AI**用的本事(Shape=visitor_only)。这正是
// 本次「能力归一化」的迁移对象:把这几个内建从进程内 Go 外置成标准 MCP server
// (架构图的 (乙))。加载机制变,但 diag/registry 看到的 id / origin / 顺序不变。
//
// **只锁对内**。对外的自管理 MCP handles 在 norm-outward-handles.spec.ts,别混。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { resetInstance } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

interface Cap { id: string; shape: string; origin: string }
interface RegistryListResp { capabilities: Cap[] }

// GOLDEN(对内)—— 注册顺序逐条锁;外置后仍标 origin=builtin(构建自带)。
// echoer 是 STANDMEET_PLUGINS 发现的外置访客插件(managed),已是"外置样板"。
const GOLDEN_INWARD: readonly Cap[] = [
  { id: 'corpus.retrieval', shape: 'visitor_only', origin: 'builtin' },
  { id: 'calendar.book', shape: 'visitor_only', origin: 'builtin' },
  { id: 'skill.runner', shape: 'visitor_only', origin: 'builtin' },
  { id: 'ext.mcp', shape: 'visitor_only', origin: 'builtin' },
  { id: 'ask_visitor', shape: 'visitor_only', origin: 'builtin' },
  { id: 'summarize_conversation', shape: 'visitor_only', origin: 'builtin' },
  { id: 'echoer', shape: 'visitor_only', origin: 'managed' },
];

test.describe('能力归一化 · 【对内】agent 能力黄金快照', () => {
  test.beforeAll(() => { resetInstance(); });

  test('inward(visitor_only)能力的 id + origin + 顺序逐字等于 golden',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const inward = (await fetchRegistry(request))
        .capabilities.filter((c) => c.shape === 'visitor_only');
      expect(inward).toEqual(GOLDEN_INWARD);
      await request.dispose();
    });

  test('多次拉取顺序稳定(prompt hash 依赖注册顺序)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const a = (await fetchRegistry(request)).capabilities.map((c) => c.id);
      const b = (await fetchRegistry(request)).capabilities.map((c) => c.id);
      expect(b).toEqual(a);
      await request.dispose();
    });
});

async function fetchRegistry(request: APIRequestContext): Promise<RegistryListResp> {
  const res = await request.get(`${BACKEND}/internal/diag/registry`);
  if (res.status() !== 200) {
    throw new Error(`diag/registry: ${res.status()} ${await res.text()}`);
  }
  return await res.json() as RegistryListResp;
}
