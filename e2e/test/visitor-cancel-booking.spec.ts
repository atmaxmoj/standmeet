// visitor-cancel-booking.spec.ts —— #123: 访客取消会议,**只能取消自己约的**。
//
// 重构后(connector deps,§二):取消不再走「React 卡 + REST postBookingCancellation」,
// 而是落在 `mcp-app-card-calendar_book` 沙盒 iframe 里 —— 卡上的 cancel 按钮 post
// `mcp-ui:tool` → host 带 **session context** 派发 `calendar_cancel` tool → tool 删
// event + 回 `mcp-ui:tool-result` → 卡进 cancelled 态。点击路径整个挪进 iframe;
// 但**隔离语义不变**:授权门依旧是「booking 的 conversation 满足 owner+code+member
// 都等于本 session 才放行,否则 404」。
//
// 隔离是这条的重点。一笔 booking 归属链:booking → conversation → member。访客
// session 带 owner_id + code_id + member_id。`calendar_cancel` tool 的授权门:用
// event_id 找到 booking,但**仅当**该 booking 的 conversation 满足 owner+code+member
// 都等于发起 tool 调用的 session 才放行,否则 404(不泄露存在性)。这一道门同时挡住:
//   - 同码跨 member(Mallory 想取消 Dana 的会)
//   - 跨 owner / 跨 code
//
// happy path 全程浏览器驱动(约 → 进 iframe 卡 → 点 cancel → tool 跑 → event 删)。
// 两条隔离负例的"攻击"本质是一个伪造的 tool 调用 —— 它从**攻击者自己已鉴权的 session**
// 发出(真实攻击面),断言被 `calendar_cancel` 的 session 门 404 挡下且受害者的 GCal
// event 仍在。tool 走 connector-backed proxy,但收件人/归属校验在 tool/后端,沙盒卡绕不过。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Browser, FrameLocator, Page } from '@playwright/test';

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

  test('happy: visitor books, clicks cancel inside the card iframe → GCal event removed',
    async ({ browser }) => {
      await resetMockGCal(seed.request);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      // 名字必须跨 sub-test 唯一:member 按 (code_id, name) 取(GetOrCreateMember),
      // 同名同码会续上同一段 open chat,前一 sub-test 的 booking 卡会泄漏进来 →
      // 后续 sub-test 的 calendar_book 定位器撞多卡 strict-mode 炸。各用独立访客隔离。
      await enterAndBook(page, seed.code.code, 'Hana', 'hana@example.com', 14);

      const before = await getMockEvents(seed.request);
      expect(before).toHaveLength(1);
      const eventID = before[0]!.event_id;

      // cancel 落在沙盒 iframe 内:卡上 cancel 按钮 post mcp-ui:tool → calendar_cancel。
      const frame = bookedFrame(page);
      await frame.getByTestId('book-card-cancel').click();
      // 卡片落到 cancelled 态(动作消失,标记 cancelled)。状态在 iframe 内的卡上。
      await expect(frame.getByTestId('tool-card-calendar_book'))
        .toHaveAttribute('data-cancelled', 'true', { timeout: 10_000 });
      await expect(frame.getByTestId('book-card-cancel')).toHaveCount(0);

      // 真删:tool 经 connector proxy 删了 mock GCal 那条 event(可观察副作用 = tool 真跑了)。
      const after = await getMockEvents(seed.request);
      expect(after.find((e) => e.event_id === eventID)).toBeUndefined();
      await ctx.close();
    });

  test('nonexistent event_id with a valid session → 404 (not 500)',
    async () => {
      const status = await attemptCancel(
        seed.request, seed.visitor.session_token, 'evt-does-not-exist');
      expect(status).toBe(404); // 合法 session,但没这笔 booking → ErrBookingNotFound
    });

  test('isolation (same code, other member): Mallory cannot cancel Dana\'s booking — but Dana can',
    ({ browser }) => crossMemberIsolation(browser, seed));

  // 单 owner 实例下跨 owner 没法真造两个 owner(resetInstance 会清掉重 claim 同一人),
  // 所以 owner 维度的隔离改用**跨 code**(同 owner、另一张 access code)覆盖 code_id 那一维。
  test('isolation (other code, same owner): a code-2 visitor cannot cancel a code-1 booking',
    ({ browser }) => crossCodeIsolation(browser, seed));
});

// crossMemberIsolation —— Dana(member A)约,Mallory(同码 member B)取消不了(404),
// 受害 event 仍在;但 Dana 本人在自己的 iframe 卡上点 cancel 可以。
async function crossMemberIsolation(browser: Browser, seed: CodedSeed): Promise<void> {
  await resetMockGCal(seed.request);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await enterAndBook(page, seed.code.code, 'Dana', 'dana@example.com', 15);
  const victimEvent = (await getMockEvents(seed.request))[0]!.event_id;

  // 攻击者 Mallory:同一张 code 下另一个 member。session 合法,但 member 不同。
  // 攻击面 = 用 Mallory 自己 session 伪造一次 calendar_cancel tool 调(沙盒卡的 mcp-ui:tool
  // 落到后端就是这条 tool-dispatch 请求);归属门在 tool/后端,挡下 → 404。
  const mallory = await issueSession(seed.request, {
    handle: OWNER.handle, mode: 'code', code: seed.code.code,
    visitor_name: 'Mallory', visitor_email: 'mallory@example.com',
  });
  expect(await attemptCancel(seed.request, mallory.session_token, victimEvent)).toBe(404);
  expect((await getMockEvents(seed.request)).find((e) => e.event_id === victimEvent))
    .toBeDefined(); // 受害者的 event 没被误删

  // 正例(同 member):这场 Mallory 取消不了,Dana 本人在 iframe 卡上点 cancel 可以。
  const frame = bookedFrame(page);
  await frame.getByTestId('book-card-cancel').click();
  await expect(frame.getByTestId('tool-card-calendar_book'))
    .toHaveAttribute('data-cancelled', 'true', { timeout: 10_000 });
  expect((await getMockEvents(seed.request)).find((e) => e.event_id === victimEvent))
    .toBeUndefined();
  await ctx.close();
}

// crossCodeIsolation —— 同 owner 另一张 code 的合法访客取消不了 code-1 的 booking。
async function crossCodeIsolation(browser: Browser, seed: CodedSeed): Promise<void> {
  await resetMockGCal(seed.request);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // 唯一名字隔离 sub-test(见 happy 测试注释:同名同码会续上同一段 chat)。
  await enterAndBook(page, seed.code.code, 'Cody', 'cody@example.com', 16);
  const victimEvent = (await getMockEvents(seed.request))[0]!.event_id;

  const code2 = await issueCodeWithSkills(seed.request, seed.csrf, {
    granted_skills: ['calendar.book'], max_bookings: 9,
  });
  const intruder = await issueSession(seed.request, {
    handle: OWNER.handle, mode: 'code', code: code2.code,
    visitor_name: 'Ivan', visitor_email: 'ivan@example.com',
  });

  const status = await attemptCancel(seed.request, intruder.session_token, victimEvent);
  expect(status).toBe(404); // code_id 不匹 → 当作不存在

  expect((await getMockEvents(seed.request)).find((e) => e.event_id === victimEvent))
    .toBeDefined(); // 受害者的 event 仍在
  await ctx.close();
}

// bookedFrame —— 已外置的 booked 卡是个沙盒 iframe;内容经 frameLocator 取。
function bookedFrame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="mcp-app-card-calendar_book"]');
}

// enterAndBook —— ?code 入口 → 填名字(+email)→ script 一次 calendar_book → 触发 →
// 等 booked 沙盒卡 iframe 出现。hour 错开真实 GCal 时段避免冲突(同 #122)。
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
  // booked 卡现在是沙盒 iframe(mcp-app-card-calendar_book),不是主 DOM 里的 React 卡。
  await expect(page.getByTestId('mcp-app-card-calendar_book')).toBeVisible({ timeout: 20_000 });
}

// attemptCancel —— 用某访客 session token 伪造一次 calendar_cancel **tool 调用**(攻击面)。
// 重构后取消是 connector-backed tool,沙盒卡经 mcp-ui:tool 触发它;落到后端就是这条
// tool-dispatch 请求。归属/授权门在 tool/后端,返 HTTP status(命中归属 → 200;否则 404)。
async function attemptCancel(
  request: APIRequestContext, token: string, eventID: string,
): Promise<number> {
  // TODO(impl): tool-dispatch endpoint for mcp-ui:tool. 重构落地后这里指向真正的
  // host tool-dispatch 路由(带 calendar_cancel + event_id args);现用占位 URL 让 spec
  // 编译通过、运行期 RED。归属校验仍后端把守,沙盒卡绕不过。
  const res = await request.post(`${BACKEND}/api/v1/visitor-tool/calendar_cancel`, {
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
