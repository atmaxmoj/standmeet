// api-key-booking-quota.spec.ts —— F-B-11 ⭐⭐：**对外 key 订会也要有上限。**
//
// prod 上驱 booking-book check 7 时抓到的（2026-08-20）：一把对外 key 连订四场，全部 200，
// 真 Google 上真长出四场会。同一趟里别的闸都在（工作时间、忙时冲突、未开的工具、吊销），
// 只有配额这一格是空的。
//
// 机制读到了行：配额是**按码**声明的（`mcpplugin.QuotaDecl{ConfigKey:"max_bookings",
// CodeField:"code_id"}`），而 key 这条路装配时用的是空 `codeOverlay{}`（没有码）——
// 这个面上**没有可数的主体**。所以修法不是补一句判断，是让配额绑在这条路真正有的那个主体上。
//
// 判据落在两处，缺一不可：
//   1. 产品**说**它拒绝了（回执里是一句读得懂的话，不是 500，也不是又一个 200）；
//   2. **日历上没多出那一场**（[[receipt-check-belongs-next-to-the-action]]：说了不算，去外面看）。
// 外加一条反向的：没设上限的 key 不许因此变成 0 次 —— 否则一个「一律拒绝」的实现也能转绿
// （[[assertion-that-cannot-fail]]）。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { createAPIToken } from '@/fixtures/admin';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { getMockEvents } from '@/fixtures/gcal';
import { seedOwnerGCalConnected, type BaseSeed } from '@/fixtures/gcal-setup';
import { callTool, initMCP } from '@/fixtures/mcp';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

interface MintResp { id: string; prefix: string; secret: string }
interface BookWire { ok?: boolean; conflict?: string; event_id?: string }
interface ToolEnvelope { result?: BookWire; reason?: string; detail?: string }

// KEY_LIMIT —— 这把 key 上允许的订会次数。2 而不是 1：1 的话「第一次就拒」和「数对了」
// 分不开。
const KEY_LIMIT = 2;

test.describe.serial('F-B-11 · an outward key books under a limit, not without one', () => {
  let seed: BaseSeed;
  let roleID = '';
  let token = '';
  let sid = '';

  test.beforeAll(async ({ playwright }) => {
    // 这段前置要 claim + 登录 + 存凭据 + 走一遍 mock OAuth + 建 skill/role/code + 起 MCP，
    // 满载串行跑时超过默认的 30s，而那时报出来的是「hook timeout」——跟产品无关。
    test.setTimeout(150_000);
    seed = await seedOwnerGCalConnected(playwright, {
      allowed_weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
      min_lead_days: 1,
    });
    // 角色链（skill → role → code）沿用发码那条 fixture，key 要的只是它那个 role。
    const code = await issueCodeWithSkills(seed.request, seed.csrf, {
      granted_skills: ['calendar.book'],
    });
    roleID = code.assumed_role_id;
    token = await createAPIToken(seed.request, seed.csrf, 'api-key-quota');
    sid = await initMCP(seed.request, token);
    await callTool(seed.request, token, sid, 'api.open', { capability_id: 'calendar.book' });
  });

  test.afterAll(async () => { await seed.request.dispose(); });

  test('the key stops at its limit, and the calendar stops with it', async () => {
    const key = await mintKey(
      { seed, token, sid, roleID }, 'limited-key', KEY_LIMIT,
    );
    const before = (await getMockEvents(seed.request)).length;

    const first = await book(seed.request, key, 'quota one', future(3, 14));
    const second = await book(seed.request, key, 'quota two', future(3, 15));
    expect(first.result?.ok, 'the first booking goes through').toBe(true);
    expect(second.result?.ok, 'the second booking goes through').toBe(true);

    const third = await book(seed.request, key, 'quota three', future(3, 16));
    expect(
      third.result?.ok ?? false,
      'the third is refused — the key has a limit and it has been reached',
    ).toBe(false);
    expect(
      JSON.stringify(third),
      'and it is refused in words the caller can act on, not a bare 500',
    ).toMatch(/quota|limit/i);

    const after = await getMockEvents(seed.request);
    expect(
      after.length - before,
      'the calendar is the fact: exactly two events, not three',
    ).toBe(KEY_LIMIT);
  });

  test('a key with no limit set is not thereby limited to zero', async () => {
    const key = await mintKey({ seed, token, sid, roleID }, 'unlimited-key', undefined);
    const res = await book(seed.request, key, 'no limit set', future(4, 14));
    expect(
      res.result?.ok,
      'no limit on the key means unlimited, not none — the omission is not a zero',
    ).toBe(true);
  });
});

// mintKey —— 通过 owner 自己那条路铸一把对外 key。`max_bookings` 跟发码时**同名**：
// 它是 calendar.book 自己声明的字段，挂在哪个主体上是参数（`capconfig/scope.go`）。
interface OwnerPath { seed: BaseSeed; token: string; sid: string; roleID: string }

async function mintKey(
  p: OwnerPath, label: string, maxBookings?: number,
): Promise<string> {
  const args: Record<string, unknown> = { label, assumed_role_id: p.roleID };
  if (maxBookings !== undefined) args['max_bookings'] = maxBookings;
  const mint = await callTool<MintResp>(p.seed.request, p.token, p.sid, 'api_keys.create', args);
  return mint.secret;
}

async function book(
  request: APIRequestContext, key: string, topic: string, when: string,
): Promise<ToolEnvelope> {
  const res = await request.fetch(`${BACKEND}/api/pub/v1/tools/calendar_book`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    data: { topic, duration_min: 30, preferred_times: [when] },
  });
  return await res.json() as ToolEnvelope;
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
