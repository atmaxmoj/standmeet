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
// mcp_servers、roles、capabilities、instance、appearance、account/me、byoai + ai_provider、
// seo、page、custom_page、chat、corpus.subjectivity、api_keys、connectors(通用注册表归
// 连接器轴,mail_test_send 归 smtp 连接器自己的 manifest)、corpus 四件(genre 从三套工具
// 收成一个参数,顺手补上 MCP 原来缺的四个格子)。
// booking 的策略更进一步:它是 booker 这个外置能力自己的配置,经通用的 capability_config 口走。
//
// writings 也搬走了(ownercore 随之删除)。当初把它留在这儿的理由写着"字节流进不了一个
// JSON op",而那句话是错的:MCP 那条路径收的从来是一串 https 地址,服务端自己去取。
// 真正搬不动的是**把两个面并成一个 op**(面板是 multipart),所以 writing_create 现在住在
// 语料域、Reach = Only(理由, "mcp") —— 差异写在声明里,而不是靠一个包躲在收口外面。
//
// 于是这份 golden 只剩 jobs 插件那三条。**它们全部搬走之后**,这个 golden 就翻面成边界
// 断言:capreg 里**不该有任何** owner_only。
const GOLDEN_OUTWARD: readonly Cap[] = [
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
