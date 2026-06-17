// visitor-cancel-booking.spec.ts —— #123: 访客取消会议,**只能取消自己约的**。
//
// 隔离是这条的重点。一笔 booking 归属链:booking → conversation → member。访客
// session 带 owner_id + code_id + member_id。取消的授权门:用 event_id 找到 booking,
// 但**仅当**该 booking 的 conversation 满足 owner+code+member 都等于本 session 才放行,
// 否则 404(不泄露存在性)。这一道门同时挡住:
//   - 同码跨 member(Mallory 想取消 Dana 的会)
//   - 跨 owner / 跨 code
//
// happy path 全程浏览器驱动(约 → 点卡片上的 cancel)。两条隔离负例的"攻击"本质是
// 一个伪造请求 —— 它从**攻击者自己已鉴权的 session** 发出(真实攻击面),断言被 404
// 挡下且受害者的 GCal event 仍在。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { getMockEvents, resetMockGCal } from '@/fixtures/gcal';
import { issueSession } from '@/fixtures/visitor';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const TOPIC = 'Intro call about backend work';

test.describe('visitor · cancel own booking + isolation (#123)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'], max_bookings: 9,
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('happy: visitor books, clicks cancel on the card → GCal event removed',
    async ({ browser }) => {
      await resetMockGCal(seed.request);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterAndBook(page, seed.code.code, 'Dana', 'dana@example.com', 14);

      const before = await getMockEvents(seed.request);
      expect(before).toHaveLength(1);
      const eventID = before[0]!.event_id;

      await page.getByTestId('book-card-cancel').click();
      // 卡片落到 cancelled 态(动作消失,标记 cancelled)。
      await expect(page.getByTestId('tool-card-calendar_book'))
        .toHaveAttribute('data-cancelled', 'true', { timeout: 10_000 });
      await expect(page.getByTestId('book-card-cancel')).toHaveCount(0);

      // 真删:mock GCal 那条 event 没了。
      const after = await getMockEvents(seed.request);
      expect(after.find((e) => e.event_id === eventID)).toBeUndefined();
      await ctx.close();
    });

  test('isolation (same code, other member): Mallory cannot cancel Dana\'s booking',
    async ({ browser }) => {
      await resetMockGCal(seed.request);
      // 受害者 Dana 通过浏览器真约一场。
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterAndBook(page, seed.code.code, 'Dana', 'dana@example.com', 15);
      const events = await getMockEvents(seed.request);
      const victimEvent = events[0]!.event_id;

      // 攻击者 Mallory:同一张 code 下另一个 member。她的 session 合法,但 member 不同。
      const mallory = await issueSession(seed.request, {
        handle: OWNER.handle, mode: 'code', code: seed.code.code,
        visitor_name: 'Mallory', visitor_email: 'mallory@example.com',
      });

      const status = await attemptCancel(seed.request, mallory.session_token, victimEvent);
      expect(status).toBe(404); // 隔离:不是你约的,当作不存在

      // 受害者的 event 仍在(没被误删)。
      const still = await getMockEvents(seed.request);
      expect(still.find((e) => e.event_id === victimEvent)).toBeDefined();
      await ctx.close();
    });

  // 单 owner 实例下跨 owner 没法真造两个 owner(resetInstance 会清掉重 claim 同一人),
  // 所以 owner 维度的隔离改用**跨 code**(同 owner、另一张 access code)覆盖 code_id 那一维。
  test('isolation (other code, same owner): a code-2 visitor cannot cancel a code-1 booking',
    async ({ browser }) => {
      await resetMockGCal(seed.request);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterAndBook(page, seed.code.code, 'Dana', 'dana@example.com', 16);
      const victimEvent = (await getMockEvents(seed.request))[0]!.event_id;

      // 同 owner 下另一张 code 的合法访客。
      const code2 = await issueCodeWithSkills(seed.request, seed.csrf, {
        granted_skills: ['calendar.book'], max_bookings: 9,
      });
      const intruder = await issueSession(seed.request, {
        handle: OWNER.handle, mode: 'code', code: code2.code,
        visitor_name: 'Ivan', visitor_email: 'ivan@example.com',
      });

      const status = await attemptCancel(seed.request, intruder.session_token, victimEvent);
      expect(status).toBe(404); // code_id 不匹 → 当作不存在

      const still = await getMockEvents(seed.request);
      expect(still.find((e) => e.event_id === victimEvent)).toBeDefined();
      await ctx.close();
    });
});

// enterAndBook —— ?code 入口 → 填名字(+email)→ script 一次 calendar_book → 触发 →
// 等 BookCard 出现。hour 错开真实 GCal 时段避免冲突(同 #122)。
async function enterAndBook(
  page: Page, code: string, name: string, email: string, hour: number,
): Promise<void> {
  await goto(page, `/?code=${code}`);
  const session = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200, { timeout: 15_000 },
  );
  await page.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('visitor-name-input').fill(name);
  await page.getByTestId('visitor-email-input').fill(email);
  await page.getByTestId('visitor-name-submit').click();
  await session;

  await scriptMockToolCall(page.request, {
    name: 'calendar_book',
    args: { topic: TOPIC, duration_min: 30, preferred_times: [future(7, hour)] },
  });
  const input = page.getByTestId('chat-input-field');
  await input.fill('book me a 30-minute chat next week, please');
  await input.press('Enter');
  await expect(page.getByTestId('tool-card-calendar_book')).toBeVisible({ timeout: 20_000 });
}

// attemptCancel —— 用某访客 session token 伪造一个取消请求(攻击面)。返 HTTP status。
async function attemptCancel(
  request: APIRequestContext, token: string, eventID: string,
): Promise<number> {
  const res = await request.post(`${BACKEND}/api/v1/booking-cancellation`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { event_id: eventID },
  });
  return res.status();
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
