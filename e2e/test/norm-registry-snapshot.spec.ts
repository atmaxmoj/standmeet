// norm-registry-snapshot.spec.ts —— 能力归一化的「黄金快照」回归网。
//
// 重构目标:让 builtin 能力和插件能力走同一套注册/装载机制(唯一区别 = UI 标
// builtin + 构建自带)。本 spec 在重构**之前**把"注册出来的全套能力"拍成 golden,
// 重构中/后必须一字不变 —— 任何能力丢失 / 多出 / 改名 / 改 shape / **改注册顺序**
// 都会被逮到。
//
// 注册顺序也锁(不是只锁集合):system prompt 的拼接顺序 = capability 注册顺序,
// 顺序一漂 system_prompt_hash 就变。归一化重构必须保持注册顺序,本 golden 守住它。
//
// 跟 registry-introspection / registry-invariants 互补:那俩只验 shape 自洽 +
// 确定性,**故意不锁具体哪些 capability**;这条就是锁那个具体集合 + 顺序。
//
// 来源标注(重构关心的分叉):
//   visitor builtin  ×6  —— RegisterVisitorSkills 写死 MustRegister
//   owner builtin    ×15 —— mcp.RegisterAgentSkills 写死 MustRegister
//   jobs plugin      ×3  —— plugins CapabilityRegistrar hook(现 origin 误标 builtin)
//   discovered       ×1  —— STANDMEET_PLUGINS 发现的 echoer(managed)

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { resetInstance } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

type Shape = 'visitor_only' | 'owner_only' | 'both';
interface Cap { id: string; shape: Shape }
interface RegistryListResp { capabilities: Cap[] }

// GOLDEN —— 注册顺序逐条锁定(顺序 = prompt 拼接顺序,不可漂)。
// 重构(把 builtin 收成统一 provider 机制)后必须**完全一致**。
const GOLDEN: readonly Cap[] = [
  // ── visitor builtin (RegisterVisitorSkills) ──
  { id: 'corpus.retrieval', shape: 'visitor_only' },
  { id: 'calendar.book', shape: 'visitor_only' },
  { id: 'skill.runner', shape: 'visitor_only' },
  { id: 'ext.mcp', shape: 'visitor_only' },
  { id: 'ask_visitor', shape: 'visitor_only' },
  { id: 'summarize_conversation', shape: 'visitor_only' },
  // ── owner builtin (mcp.RegisterAgentSkills) ──
  { id: 'owner.me', shape: 'owner_only' },
  { id: 'seo.bundle', shape: 'owner_only' },
  { id: 'codes.bundle', shape: 'owner_only' },
  { id: 'corpus.raw.bundle', shape: 'owner_only' },
  { id: 'corpus.output.bundle', shape: 'owner_only' },
  { id: 'corpus.mutations.bundle', shape: 'owner_only' },
  { id: 'chat.bundle', shape: 'owner_only' },
  { id: 'prompts.bundle', shape: 'owner_only' },
  { id: 'roles.bundle', shape: 'owner_only' },
  { id: 'mcp_servers.bundle', shape: 'owner_only' },
  { id: 'skills.bundle', shape: 'owner_only' },
  { id: 'writings.bundle', shape: 'owner_only' },
  { id: 'custom_page.bundle', shape: 'owner_only' },
  { id: 'page.bundle', shape: 'owner_only' },
  { id: 'calendar.bundle', shape: 'owner_only' },
  // ── jobs plugin (CapabilityRegistrar hook) ──
  { id: 'jobs.bundle', shape: 'owner_only' },
  { id: 'resume.bundle', shape: 'owner_only' },
  { id: 'applications.bundle', shape: 'owner_only' },
  // ── discovered plugin (STANDMEET_PLUGINS) ──
  { id: 'echoer', shape: 'visitor_only' },
];

test.describe('能力归一化 · 注册黄金快照(重构安全网)', () => {
  test.beforeAll(() => { resetInstance(); });

  test('registry 注册的全套 capability(id + shape + 顺序)逐字等于 golden',
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
