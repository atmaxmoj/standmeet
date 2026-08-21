// booking-slot-race.spec.ts —— F-B-15 ⭐⭐：**同一格不许被订两次。**
//
// prod 上真跑出来的（2026-08-21，真 Google、一把对外 key）：两条一模一样的订会请求**同时**发出，
// 两条都回 200、两个不同的 `event_id`，Google 上并排两场会。owner 的同一个半小时被占了两次。
//
// item 的 check 5 原话说的是「provider 对重复插入回一个冲突」—— Google 根本不这么做
// （`events.insert` 两次就是两场，它不认为那是错）。但那句话要守的东西很清楚：**访客不许被双订**。
// 这条守卫把它翻成这个环境**判得了负**的形状：两个请求争同一格。
//
// 机制上就没有互斥：订会是「先问忙时 → 再插入」，中间没有任何东西阻止第二个请求在同一个窗口里
// 读到同样的「空着」。这不是 provider 的问题，是产品这一侧缺一个「这一格已经有人在订了」的占位。
//
// 判据落在**日历那一侧**，不在回执上（[[receipt-check-belongs-next-to-the-action]]）：产品说了什么
// 都不算数，provider 上到底长出几场才算。反向那条同样不可少 —— 不同时段并发照样各自成功，
// 否则一个「全局串行、谁都别想并发」的实现也能让第一条转绿（[[assertion-that-cannot-fail]]）。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { createAPIToken } from '@/fixtures/admin';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { getMockEvents } from '@/fixtures/gcal';
import { seedOwnerGCalConnected, type BaseSeed } from '@/fixtures/gcal-setup';
import { callTool, initMCP } from '@/fixtures/mcp';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

interface MintResp { id: string; prefix: string; secret: string }
interface BookWire { ok?: boolean; event_id?: string; conflict?: string }
interface ToolEnvelope { result?: BookWire; reason?: string }

test.describe.serial('F-B-15 · two callers cannot take the same slot', () => {
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
    const token = await createAPIToken(seed.request, seed.csrf, 'api-key-race');
    const sid = await initMCP(seed.request, token);
    await callTool(seed.request, token, sid, 'api.open', { capability_id: 'calendar.book' });
    const mint = await callTool<MintResp>(seed.request, token, sid, 'api_keys.create', {
      label: 'race-key', assumed_role_id: code.assumed_role_id,
    });
    key = mint.secret;
  });

  test.afterAll(async () => { await seed.request.dispose(); });

  test('the same slot, asked for twice at once, is booked once', async () => {
    const when = future(5, 15);
    const before = (await getMockEvents(seed.request)).length;

    const [a, b] = await Promise.all([
      book(seed.request, key, 'race one', when),
      book(seed.request, key, 'race two', when),
    ]);

    const after = await getMockEvents(seed.request);
    expect(
      after.length - before,
      'the calendar is the fact: one of the two callers got the slot, not both — a second event '
      + 'at the same time is the owner double-booked',
    ).toBe(1);

    const won = [a, b].filter((r) => r.result?.ok === true);
    expect(won.length, 'exactly one receipt says it booked').toBe(1);
    const lost = [a, b].find((r) => r.result?.ok !== true);
    expect(
      JSON.stringify(lost),
      'and the loser is told something it can act on — a time that just went is not an error '
      + 'the caller caused',
    ).toMatch(/busy|taken|conflict|unavailable/i);
  });

  test('different slots at the same moment both go through', async () => {
    const before = (await getMockEvents(seed.request)).length;

    const [a, b] = await Promise.all([
      book(seed.request, key, 'parallel one', future(6, 14)),
      book(seed.request, key, 'parallel two', future(6, 16)),
    ]);

    expect(a.result?.ok, 'first slot booked').toBe(true);
    expect(b.result?.ok, 'second slot booked').toBe(true);
    expect(
      (await getMockEvents(seed.request)).length - before,
      'holding one slot must not serialise the whole calendar',
    ).toBe(2);
  });
});

async function book(
  request: APIRequestContext, apiKey: string, topic: string, when: string,
): Promise<ToolEnvelope> {
  const res = await request.fetch(`${BACKEND}/api/pub/v1/tools/calendar_book`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
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
