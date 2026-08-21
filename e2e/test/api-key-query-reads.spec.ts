// api-key-query-reads.spec.ts —— F-B-13：**读就说自己是读。**
//
// 驱 booking-book check 7 时看到的（2026-08-20）：`GET /api/pub/v1/tools` 里
// `calendar_list_slots` 的 `read_only` 是 **false**，而四个 `corpus_*` 都是 true。列时段是安全且
// 幂等的 —— 它正是 `QUERY` 这个方法存在的理由（RFC 10008：带 body 的读）。一个读被登记成写，
// 调用方只能用 POST，而「这次调用会不会改变什么」这个问题**产品自己回答错了**。
//
// 这一格来自工具自己声明的 MCP `annotations.readOnlyHint`（`capreg/binding_tool.go:55`），
// booker 插件从没给它的读工具声明过。
//
// 判据不是「那一格写着 true」，是**那个方法真的能用**：先断 QUERY 打得通（这才是这一格解锁的
// 能力），再断写工具上的 QUERY 仍然被拒 —— 否则一个「一律 read_only:true」的实现也能转绿
// （[[assertion-that-cannot-fail]]）。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { createAPIToken } from '@/fixtures/admin';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { seedOwnerGCalConnected, type BaseSeed } from '@/fixtures/gcal-setup';
import { callTool, initMCP } from '@/fixtures/mcp';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

interface MintResp { id: string; prefix: string; secret: string }
interface DiscoverBody { tools: Array<{ name: string; read_only: boolean }> }

test.describe.serial('F-B-13 · a safe read is declared as one, and QUERY works on it', () => {
  let seed: BaseSeed;
  let key = '';

  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(150_000);
    seed = await seedOwnerGCalConnected(playwright, {
      allowed_weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
      min_lead_days: 1,
    });
    const code = await issueCodeWithSkills(seed.request, seed.csrf, {
      granted_skills: ['calendar.book'],
    });
    const token = await createAPIToken(seed.request, seed.csrf, 'api-key-query');
    const sid = await initMCP(seed.request, token);
    await callTool(seed.request, token, sid, 'api.open', { capability_id: 'calendar.book' });
    const mint = await callTool<MintResp>(seed.request, token, sid, 'api_keys.create', {
      label: 'query-key', assumed_role_id: code.assumed_role_id,
    });
    key = mint.secret;
  });

  test.afterAll(async () => { await seed.request.dispose(); });

  test('listing slots says it is read-only; booking says it is not', async () => {
    const res = await seed.request.get(`${BACKEND}/api/pub/v1/tools`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const body = await res.json() as DiscoverBody;
    const flag = (n: string) => body.tools.find((t) => t.name === n)?.read_only;
    expect(flag('calendar_list_slots'), 'listing free slots changes nothing').toBe(true);
    expect(
      flag('calendar_book'), 'booking does change something — the flag must still separate them',
    ).toBe(false);
  });

  test('QUERY reaches the read tool and is still refused on the write tool', async () => {
    const read = await query(seed.request, key, 'calendar_list_slots', {
      from_rfc3339: future(2), until_rfc3339: future(4), duration_min: 30,
    });
    expect(read.status, 'QUERY is what a body-carrying read is for').toBe(200);

    const write = await query(seed.request, key, 'calendar_book', {
      topic: 'should never happen', duration_min: 30, preferred_times: [future(3)],
    });
    expect(
      write.status, 'and a state-changing tool still refuses it — QUERY promises safe + idempotent',
    ).toBe(405);
  });
});

async function query(
  request: APIRequestContext, key: string, name: string, body: unknown,
): Promise<{ status: number }> {
  const res = await request.fetch(`${BACKEND}/api/pub/v1/tools/${name}`, {
    method: 'QUERY',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    data: body,
  });
  return { status: res.status() };
}

function future(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(14, 0, 0, 0);
  return d.toISOString();
}
