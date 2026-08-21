// api-key-booking-invitee.spec.ts —— F-B-12 ⭐：**对外 key 订的会也得有客人。**
//
// prod 上驱 booking-book check 7 时看到的（2026-08-20）：经 `/api/pub/v1` 订的每一场会，回执里
// `invited_email` 都是空串，Google 上打开是**零参会人**；而同一天用聊天那条路订的那场，客人好好
// 地挂在上面。这条路的成品是 owner 日历上一场真的会，一场没有客人的会等于 owner 到点了对着空房间。
//
// **为什么不是「给工具加个参数」**：F-B-6 已经判过一次 —— 让模型自己填收件人，它会从对话里
// 编一个出来。所以邀请人**只从会话身份来**，`calendar_book` 不收 `visitor_email` 这个 tool arg。
// key 这条路上没有会话身份可言（调用方是别人的程序），缺的正是那一格：**代谁而约**。
//
// 修法因此是把它放在**会话那一层**而不是工具参数里：调用方在请求头上说明自己代表谁，facade
// 把它当成这一场的访客身份 —— 插件那边一行不改，F-B-6 的规矩仍然成立。
//
// 判据落在**外面**：回执说了不算，去 provider 那儿看这场会到底有没有这个人
// （[[receipt-check-belongs-next-to-the-action]]）。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { createAPIToken } from '@/fixtures/admin';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { getMockEvents } from '@/fixtures/gcal';
import { seedOwnerGCalConnected, type BaseSeed } from '@/fixtures/gcal-setup';
import { callTool, initMCP } from '@/fixtures/mcp';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const GUEST = 'programmatic.guest@example.com';

interface MintResp { id: string; prefix: string; secret: string }
interface BookWire { ok?: boolean; invited_email?: string; event_id?: string }
interface ToolEnvelope { result?: BookWire; reason?: string }

test.describe.serial('F-B-12 · a booking made through a key can name its guest', () => {
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
    const token = await createAPIToken(seed.request, seed.csrf, 'api-key-invitee');
    const sid = await initMCP(seed.request, token);
    await callTool(seed.request, token, sid, 'api.open', { capability_id: 'calendar.book' });
    const mint = await callTool<MintResp>(seed.request, token, sid, 'api_keys.create', {
      label: 'invitee-key', assumed_role_id: code.assumed_role_id,
    });
    key = mint.secret;
  });

  test.afterAll(async () => { await seed.request.dispose(); });

  test('the guest the caller names is on the event at the provider', async () => {
    const res = await book(seed.request, key, 'invitee audit', future(6, 14), GUEST);
    expect(res.result?.ok, 'the booking goes through').toBe(true);
    expect(res.result?.invited_email, 'the receipt names who was invited').toBe(GUEST);

    const evs = await getMockEvents(seed.request);
    const mine = evs.find((e) => e.summary.includes('invitee audit'));
    expect(mine, 'the event is at the provider').toBeTruthy();
    expect(
      (mine?.attendees ?? []).map((a) => a.email),
      'and the guest is on it — a receipt that says "invited" while the event has nobody is the '
      + 'defect this guards',
    ).toContain(GUEST);
    expect(
      mine?.send_updates, 'the provider was asked to notify them, not merely to list them',
    ).toBeTruthy();
  });

  test('with nobody named, the receipt says so instead of going quiet', async () => {
    const res = await book(seed.request, key, 'no guest audit', future(6, 16), '');
    expect(res.result?.ok, 'an owner-only hold is still a valid booking').toBe(true);
    expect(
      res.result?.invited_email,
      'and the receipt is explicit that nobody was invited — the caller must be able to tell '
      + 'the two outcomes apart',
    ).toBe('');
  });
});

// book —— 走 facade 订一场。`X-Standmeet-Visitor-Email` 说的是**代谁而约**：它属于会话身份，
// 不是工具参数（F-B-6：收件人不能由模型/载荷决定）。
async function book(
  request: APIRequestContext, apiKey: string, topic: string, when: string, guest: string,
): Promise<ToolEnvelope> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json',
  };
  if (guest !== '') headers['X-Standmeet-Visitor-Email'] = guest;
  const res = await request.fetch(`${BACKEND}/api/pub/v1/tools/calendar_book`, {
    method: 'POST', headers,
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
