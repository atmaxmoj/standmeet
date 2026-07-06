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
const GOLDEN_OUTWARD: readonly Cap[] = [
  { id: 'owner.me', shape: 'owner_only', origin: 'builtin' },
  { id: 'seo.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'codes.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'corpus.raw.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'corpus.output.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'corpus.mutations.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'corpus.subjectivity.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'appearance.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'chat.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'prompts.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'roles.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'mcp_servers.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'skills.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'writings.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'custom_page.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'page.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'calendar.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'jobs.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'resume.bundle', shape: 'owner_only', origin: 'builtin' },
  { id: 'applications.bundle', shape: 'owner_only', origin: 'builtin' },
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
