// connector-err-mcp-ui-tool-dispatch.spec.ts —— §四 错误流矩阵 E12（R4 新路径）
// 沙盒卡 post `mcp-ui:tool` 派发具名工具 → host 带 session context 派发。三种失败:
//   (a) host 派发本身失败,
//   (b) session 失效/过期,
//   (c) card-action 进行中 quota 耗尽,
// 每种都该让卡内显示友好结果、chat **不挂死/不崩**。
//
// Error stream E12: a sandbox card posts mcp-ui:tool but the dispatch path fails —
// (a) host dispatch error, (b) invalid/expired session, (c) quota exhausted
// mid-card-action — in each case the card shows a friendly result and the chat
// does not hang or crash.
//
// RED / TDD：依赖 mcp-ui:tool host 派发把这三类失败映射成卡内友好结果落地后转绿。

import { test, expect } from '@/fixtures/test';
import type { FrameLocator, Page, Playwright } from '@playwright/test';

import { configureMailConnector, clearMailpit } from '@/fixtures/mail';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

const TOPIC = 'Intro call about backend work';
const TOOL_ROUTE = '**/api/v1/sessions/*/tools/send_confirmation';

// 三类派发故障用 Playwright 劫持卡的 /tools 请求制造(不动后端、不留 test seam):
//   (a) host 派发失败 → 502; (b) session 失效 → 401; (c) 配额耗尽 → 200 ok:false。
// 卡的 mcp-ui:tool 由父页 callVisitorTool fetch,故 page.route 能拦到。
async function failHostDispatch(page: Page): Promise<void> {
  await page.route(TOOL_ROUTE, (route) => route.fulfill({
    status: 502, contentType: 'application/json',
    body: JSON.stringify({ ok: false, reason: 'dispatch_fault' }),
  }));
}
async function expireSession(page: Page): Promise<void> {
  await page.route(TOOL_ROUTE, (route) => route.fulfill({
    status: 401, contentType: 'application/json',
    body: JSON.stringify({ ok: false, reason: 'session_expired' }),
  }));
}
async function exhaustCardActionQuota(page: Page): Promise<void> {
  await page.route(TOOL_ROUTE, (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: false, reason: 'quota_exhausted' }),
  }));
}

test.describe('connector error stream · mcp-ui:tool dispatch failures degrade in-card (E12)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  // (a) host 派发本身失败 → 卡内友好结果,chat 不挂死。
  test('(a) host dispatch fails → card shows a friendly result, chat does not hang',
    async ({ browser }) => {
      await clearMailpit(seed.request);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterAndBook(page, seed.code.code, 'Dana', 14, 'dana.a@example.com');

      await failHostDispatch(page);
      const frame = bookedFrame(page);
      await frame.getByTestId('booking-email-use-profile').click();

      await assertFriendlyCardError(frame);
      await assertChatAlive(page);
      await ctx.close();
    });

  // (b) session 失效/过期 → 派发被拒,卡内友好结果(提示重进),chat 不崩。
  test('(b) session invalid/expired → card shows a friendly result, chat does not crash',
    async ({ browser }) => {
      await clearMailpit(seed.request);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterAndBook(page, seed.code.code, 'Eli', 15, 'eli.b@example.com');

      await expireSession(page);
      const frame = bookedFrame(page);
      await frame.getByTestId('booking-email-use-profile').click();

      await assertFriendlyCardError(frame);
      await assertChatAlive(page);
      await ctx.close();
    });

  // (c) card-action 进行中 quota 耗尽 → 卡内友好结果,chat 不挂死。
  test('(c) quota exhausted mid-card-action → card shows a friendly result, chat does not hang',
    async ({ browser }) => {
      await clearMailpit(seed.request);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterAndBook(page, seed.code.code, 'Mara', 16, 'mara.c@example.com');

      await exhaustCardActionQuota(page);
      const frame = bookedFrame(page);
      await frame.getByTestId('booking-email-use-profile').click();

      await assertFriendlyCardError(frame);
      await assertChatAlive(page);
      await ctx.close();
    });
});

// assertFriendlyCardError —— 卡内出现友好错误(非 sent、无 stack)。
async function assertFriendlyCardError(frame: FrameLocator): Promise<void> {
  const err = frame.getByTestId('booking-email-error');
  await expect(err, 'friendly in-card error').toBeVisible({ timeout: 10_000 });
  const text = (await err.textContent()) ?? '';
  expect(text, 'no stack / raw error in card')
    .not.toMatch(/panic|goroutine|stack|dial tcp|connection refused|500/i);
  await expect(frame.getByTestId('booking-email-prompt')).toHaveAttribute('data-sent', 'false');
}

// assertChatAlive —— 派发失败后 chat 没挂死:输入框仍可交互(可再发一句)。
async function assertChatAlive(page: Page): Promise<void> {
  const input = page.getByTestId('chat-input-field');
  await expect(input, 'chat input still interactive (no hang)').toBeEnabled({ timeout: 10_000 });
  await input.fill('still here?');
  await expect(input).toHaveValue('still here?');
}

function bookedFrame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="mcp-app-card-calendar_book"]');
}

// enterAndBook —— ?code 入口 → 填名 + email → script calendar_book → 等沙盒卡。
// 返回 conversation_id(供 session/quota 故障注入用)。
async function enterAndBook(
  page: Page, code: string, name: string, hour: number, email: string,
): Promise<string> {
  await goto(page, `/?code=${code}`);
  const sessionResp = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200, { timeout: 15_000 },
  );
  await page.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('visitor-name-input').fill(name);
  await page.getByTestId('visitor-email-input').fill(email);
  await page.getByTestId('visitor-name-submit').click();
  const resolved = await sessionResp;
  const body = await resolved.json() as { conversation_id: string };

  const tag = await scriptMockToolCall(page.request, {
    name: 'calendar_book',
    args: { topic: TOPIC, duration_min: 30, preferred_times: [future(7, hour)] },
  });
  const input = page.getByTestId('chat-input-field');
  await input.fill(`book me a 30-minute chat next week, please${tag}`);
  await input.press('Enter');
  await expect(page.getByTestId('mcp-app-card-calendar_book')).toBeVisible({ timeout: 20_000 });
  const frame = bookedFrame(page);
  await expect(frame.getByTestId('booking-email-prompt')).toBeVisible({ timeout: 10_000 });
  return body.conversation_id;
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

async function prep(playwright: Playwright): Promise<CodedSeed> {
  const seed = await seedCodeVisitorOnConnectedOwner(playwright, {
    granted_skills: ['calendar.book'], max_bookings: 9,
  });
  await configureMailConnector(seed.request, OWNER.email, OWNER.password);
  return seed;
}
