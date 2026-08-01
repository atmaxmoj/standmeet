// norm-outward-handles.spec.ts —— 【对外 / outward】自管理 MCP handles 黄金快照。
//
// 对外 handles = StandMeet 把**自己当被管理对象**,开给 owner 的 MCP 工具(owner
// 从他自己的 Claude Code / Desktop 连进来管 StandMeet:管 code、改 corpus、配 role
// …;Shape=owner_only)。这是 StandMeet 的 **as-MCP-server 朝向**,**不是**装载进
// agent 的能力 —— **本次归一化不碰它**。
//
// 锁在这儿是为了证明"归一化只动对内能力、没误伤这批对外 handle"。
// 对内能力在 norm-inward-capabilities.spec.ts,别混。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { resetInstance } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

interface Cap { id: string; shape: string; origin: string }
interface RegistryListResp { capabilities: Cap[] }

// GOLDEN(对外)—— 全 owner_only,本次不动,origin 全 builtin。
// 注:jobs/resume/applications 也在此 —— 它们是 owner-facing 的自管理 MCP,
// 跟 codes/seo 同类,不是对内能力。
//
// **这份 golden 会随 ownercore 解散而变短。** owner 的自管理工具本来就不该注册进 capreg
// (capreg 是"本机 agent 能装载什么"的声明注册表,是另一根轴);它们正在搬进出站收口
// (backend/internal/routes/dispatcher),由收口投影到 MCP 面。搬走一个,这里删一行。
// 删空之后这个 golden 就翻面成边界断言:capreg 里**不该有任何** owner_only。
//
// 已搬走(→ dispatcher):ip_bans、domains、access_requests、skills、marketplace、prompts、
// mcp_servers、roles、capabilities、instance、appearance、account/me、byoai + ai_provider。
// booking 的策略更进一步:它是 booker 这个外置能力自己的配置,经通用的 capability_config 口走。
const GOLDEN_OUTWARD: readonly Cap[] = [
  { id: 'jobs.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'resume.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'applications.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'seo.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'corpus.raw.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'corpus.output.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'corpus.mutations.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'corpus.subjectivity.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'chat.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'writings.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'custom_page.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'page.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'api_keys.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'connectors.bundle', shape: 'owner_only', origin: 'builtin' },
];

test.describe('能力归一化 · 【对外】自管理 MCP handles 黄金快照(本次不碰)', () => {
  test.beforeAll(() => { resetInstance(); });

  test('outward(owner_only)handles 的 id + origin + 顺序逐字等于 golden',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const outward = (await fetchRegistry(request))
        .capabilities.filter((c) => c.shape === 'owner_only');
      expect(outward).toEqual(GOLDEN_OUTWARD);
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
