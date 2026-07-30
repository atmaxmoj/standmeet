// norm-inward-capabilities.spec.ts —— 【对内 / inward】能力黄金快照(归一化安全网)。
//
// 对内能力 = 装载进 agent、给**访客 AI**用的本事,即 **visitor-facing**:shape 为 visitor_only
// 或 both。判据跟后端唯一的 shape 闸一致(capreg.VisitorCapabilityIDs: Shape() != owner_only)——
// 一个能力同时服务 owner 面(booker 经 manifest.OwnerTools 出 calendar.list_slots)并不使它退出
// 对内快照;拿 `=== 'visitor_only'` 当判据会让它悄悄掉出覆盖面。这正是
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
// ask_visitor 已外置成独立 module，由 composition root 经 in-process 走统一插件路径
// 以 origin=builtin 加载（在 RegisterVisitorSkills 之后）→ 注册顺序挪到
// summarize_conversation 之后、echoer(managed 第三方)之前。id/shape/origin 不变。
const GOLDEN_INWARD: readonly Cap[] = [
  // skill.runner + ext.mcp 是 loader/机制（不是 leaf 能力），留在 capreg 内建注册口。
  { id: 'skill.runner', shape: 'visitor_only', origin: 'builtin' },
  { id: 'ext.mcp', shape: 'visitor_only', origin: 'builtin' },
  // connector.agent_tools —— openapi 连接器开了 expose_as_agent_tools 后，把 raw operations
  // 暴露成 per-session agent 工具（Shape=VisitorOnly，boot 注册；具体访客看不看得到由 per-session
  // SessionGate 决定）。connector 重构 #155 §3 落地，注册于 ext.mcp 之后、leaf 能力之前。
  { id: 'connector.agent_tools', shape: 'visitor_only', origin: 'builtin' },
  // ask_visitor + summarize_conversation + calendar.book + corpus.retrieval —— 四个
  // leaf 能力全外置成沙箱插件（mcp-servers/*），经 registerBuiltins 走统一 sandbox_stdio
  // 路径以 origin=builtin 加载（在 capreg loader 之后、managed 第三方之前）。主 app 内
  // 已无任何 specific MCP 能力代码。id/shape/origin 不变，加载机制变。calendar.book 还叠
  // 一个 SessionGate（connector+quota）做 per-session 隐藏。
  { id: 'ask_visitor', shape: 'visitor_only', origin: 'builtin' },
  { id: 'summarize_conversation', shape: 'visitor_only', origin: 'builtin' },
  // calendar.book —— shape=both:访客侧 calendar_book / calendar_list_slots,owner 侧
  // calendar.list_slots(manifest.OwnerTools,沙箱实现)。策略评估 + slot 枚举只此一份。
  { id: 'calendar.book', shape: 'both', origin: 'builtin' },
  { id: 'corpus.retrieval', shape: 'visitor_only', origin: 'builtin' },
  // mail.send —— 内置 SMTP 连接器 expose_as_agent_tools 暴露的发信 operation（访客侧
  // 「预约成功→发确认邮件」#122）。同 connector.agent_tools，Shape=VisitorOnly + per-session gate。
  { id: 'mail.send', shape: 'visitor_only', origin: 'builtin' },
  { id: 'echoer', shape: 'visitor_only', origin: 'managed' },
  // everything / fsmcp —— 真·第三方 MCP server（@modelcontextprotocol 官方参考
  // server），经 sandbox_stdio 在 bwrap 隔离里加载（STANDMEET_PLUGINS 声明，managed）。
  // 证明统一加载器对"我们没写的" server 也成立，且沙箱关押是真的。
  { id: 'everything', shape: 'visitor_only', origin: 'managed' },
  { id: 'fsmcp', shape: 'visitor_only', origin: 'managed' },
  // wsfs —— server-filesystem rooted at /workspace（sandbox.workspace=true）：跑 per-session
  // 工作区 TTL/cron 生命周期（#148）。复用 fsmcp 代码，managed。
  { id: 'wsfs', shape: 'visitor_only', origin: 'managed' },
  // netfetch / cagedfetch —— 同一个真 fetch server(mcp-server-fetch），差别只在
  // 沙箱网络策略:netfetch 放行 egress、cagedfetch --network=none。验网络关押双向。
  { id: 'netfetch', shape: 'visitor_only', origin: 'managed' },
  { id: 'cagedfetch', shape: 'visitor_only', origin: 'managed' },
  // escapee —— 对抗插件:server-filesystem rooted at /，专门用来主动尝试逃逸(读
  // docker.sock / 宿主 config / 路径穿越)，证明 bwrap 把这些全挡住。
  { id: 'escapee', shape: 'visitor_only', origin: 'managed' },
];

test.describe('能力归一化 · 【对内】agent 能力黄金快照', () => {
  test.beforeAll(() => { resetInstance(); });

  test('inward(visitor-facing)能力的 id + shape + origin + 顺序逐字等于 golden',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const inward = (await fetchRegistry(request))
        .capabilities.filter((c) => c.shape !== 'owner_only');
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
