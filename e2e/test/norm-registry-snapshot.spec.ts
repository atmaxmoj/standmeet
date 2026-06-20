// norm-registry-snapshot.spec.ts —— 能力归一化的「黄金快照」回归网。
//
// 归一化 = 把 6 个内建 **inward 能力**(访客 AI 能用的本事:retrieval / booker /
// skill.runner / ext.mcp / ask_visitor / summarize)从进程内 Go 写死,**外置成标准
// MCP server**(各自目录/进程 + manifest + 被 core dial,跟 echoer / jobs 已有的外
// 置样子一致;架构图 platform-architecture.md 的 (乙))。
//
// 关键:加载机制变了(进程内 Go → 外置 MCP server),但这对 `diag/registry` 看到
// 的东西**完全不可见** —— id / shape / origin / 注册顺序都不该变。所以本 golden
// 全程**一字不变**,任何能力丢/多/改名/改 shape/改 origin/改顺序都会被逮到。
//
// 注册顺序也锁:system prompt 拼接顺序 = capability 注册顺序,顺序一漂 hash 就变。
//
// 跟 registry-introspection / registry-invariants 互补:那俩只验 shape 自洽 +
// 确定性,**故意不锁具体哪些 capability**;这条锁那个具体集合 + 顺序 + origin。
//
// 来源标注(只第一组是本次迁移对象;其余本次不碰):
//   inward 能力(迁移对象)×6 —— 现 RegisterVisitorSkills 写死,将外置成 MCP server
//   自管理 MCP(owner_only) ×15 —— mcp.RegisterAgentSkills(owner 从 Claude Code 管
//                                 StandMeet 的 handles;as-MCP-server 朝向,本次不碰)
//   jobs/resume/applications ×3 —— 也是自管理 MCP(owner-facing),本次不碰
//   discovered echoer        ×1 —— STANDMEET_PLUGINS 发现的外置插件(managed),已是样板

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { resetInstance } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

type Shape = 'visitor_only' | 'owner_only' | 'both';
type Origin = 'builtin' | 'managed' | 'owner';
interface Cap { id: string; shape: Shape; origin: Origin }
interface RegistryListResp { capabilities: Cap[] }

// GOLDEN —— 注册顺序 + id + shape + **origin** 逐条锁定,**全程不变**。
// 顺序 = prompt 拼接顺序,不可漂;origin 锁住"谁是 builtin / managed / owner"。
// 本次归一化只把前 6 个 inward 能力的**加载机制**外置(进程内 Go → MCP server),
// 那对 diag/registry 不可见;内建仍标 origin=builtin(构建自带)。所以这 25 行
// **一条都不该变** —— 包括 jobs(它是自管理 MCP、本次不碰,origin 保持 builtin)。
const GOLDEN: readonly Cap[] = [
  // ── inward 能力(本次迁移对象;外置后仍标 builtin) ──
  { id: 'corpus.retrieval', shape: 'visitor_only', origin: 'builtin' },
  { id: 'calendar.book', shape: 'visitor_only', origin: 'builtin' },
  { id: 'skill.runner', shape: 'visitor_only', origin: 'builtin' },
  { id: 'ext.mcp', shape: 'visitor_only', origin: 'builtin' },
  { id: 'ask_visitor', shape: 'visitor_only', origin: 'builtin' },
  { id: 'summarize_conversation', shape: 'visitor_only', origin: 'builtin' },
  // ── 自管理 MCP(owner-facing,本次不碰) ──
  { id: 'owner.me', shape: 'owner_only', origin: 'builtin' },
  { id: 'seo.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'codes.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'corpus.raw.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'corpus.output.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'corpus.mutations.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'chat.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'prompts.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'roles.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'mcp_servers.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'skills.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'writings.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'custom_page.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'page.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'calendar.bundle', shape: 'owner_only', origin: 'builtin' },
  // ── jobs/resume/applications:也是自管理 MCP(owner-facing),本次不碰 ──
  { id: 'jobs.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'resume.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'applications.bundle', shape: 'owner_only', origin: 'builtin' },
  // ── discovered 外置插件(STANDMEET_PLUGINS;已是外置样板) ──
  { id: 'echoer', shape: 'visitor_only', origin: 'managed' },
];

test.describe('能力归一化 · 注册黄金快照(重构安全网)', () => {
  test.beforeAll(() => { resetInstance(); });

  test('registry 注册的全套 capability(id + shape + origin + 顺序)逐字等于 golden',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const list = await fetchRegistry(request);
      // 逐条相等 = 锁集合 + 锁 shape + 锁注册顺序。
      expect(list.capabilities).toEqual(GOLDEN);
      await request.dispose();
    });

  test('多次拉取注册顺序稳定(prompt hash 依赖之)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const a = await fetchRegistry(request);
      const b = await fetchRegistry(request);
      expect(b.capabilities.map((c) => c.id)).toEqual(a.capabilities.map((c) => c.id));
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
