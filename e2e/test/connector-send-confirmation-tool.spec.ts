// connector-send-confirmation-tool.spec.ts —— §一(send_confirmation 作 tool)+ D-4
//
// 今天发确认信走 REST。重构后它成 connector-backed **tool**:booked 沙盒卡里的
// 确认 widget 点「引用/透传/skip」后 post `{type:'mcp-ui:tool', name:'send_confirmation',
// args}` → host 带 session context 派发 `send_confirmation` tool → tool 经 mail
// connector proxy 发信 → 回 `mcp-ui:tool-result` → 卡进 sent/error 态。
//
// **收件人硬控放 tool/后端(D-4):**
//   - 引用:发到 **session-email**(后端从 session 取,卡传不传都以后端为准)
//   - 透传:发到访客字面 typed address
//   - 非法地址:**后端 422**(ParseAddress 失败)→ 卡内 error、零发送 —— 沙盒卡绕不过
//   - skip:不调 tool、不发信
//
// 这条专守 TOOL 路径 + 后端收件人校验(跟 booking-confirmation-email 的卡内交互互补:
// 那条覆盖完整四态 UX,这条钉死「校验在 tool/后端,valid→发、invalid→422+零发」)。
//
// RED / TDD:在 send_confirmation 成为 tool(经 mcp-ui:tool 调、后端校验收件人)之前,
// 运行期失败。

import { test, expect } from '@/fixtures/test';
import type { Browser, FrameLocator, Page } from '@playwright/test';

import {
  configureMailConnector, clearMailpit, waitForMailEnvelopeTo,
  countMailpitMessages, MAIL_FROM,
} from '@/fixtures/mail';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

const TOPIC = 'Intro call about backend work';

test.describe('connector · send_confirmation as a tool (§一 + D-4 recipient hardening)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'], max_bookings: 9,
    });
    await configureMailConnector(seed.request, OWNER.email, OWNER.password);
    await clearMailpit(seed.request);
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('引用(session-email): send_confirmation tool mails the session email (backend-sourced)',
    ({ browser }) => quoteFlow(browser, seed));
  test('透传(typed address): send_confirmation tool mails the typed address',
    ({ browser }) => passthroughFlow(browser, seed));
  test('非法收件人 → backend 422 in the tool, card error, nothing sent',
    ({ browser }) => invalidRecipientFlow(browser, seed));
  test('skip → tool not invoked, no email sent',
    ({ browser }) => skipFlow(browser, seed));
});

// 引用 —— session 带 email → 点引用 → send_confirmation tool 发到 **session-email**。
// 收件人由后端从 session 取(硬控),不信卡传来的字面值。
async function quoteFlow(browser: Browser, seed: CodedSeed): Promise<void> {
  await clearMailpit(seed.request);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await enterWithProfile(page, seed.code.code, 'Dana', 'dana.session@example.com');
  await bookInChat(page, 14);

  const frame = bookedFrame(page);
  const prompt = frame.getByTestId('booking-email-prompt');
  await expect(prompt).toBeVisible({ timeout: 10_000 });
  await frame.getByTestId('booking-email-use-profile').click();

  // 可观察:tool 经 mail connector proxy 发了一封到 session-email;一笔一发。
  const mail = await waitForMailEnvelopeTo(seed.request, 'dana.session@example.com');
  expect(mail.from).toBe(MAIL_FROM);
  expect(mail.text).toContain(TOPIC);
  await expect(prompt).toHaveAttribute('data-sent', 'true', { timeout: 5_000 });
  expect(await countMailpitMessages(seed.request)).toBe(1);
  await ctx.close();
}

// 透传 —— 没 session email → 现填地址 → send_confirmation tool 发到该字面地址。
async function passthroughFlow(browser: Browser, seed: CodedSeed): Promise<void> {
  await clearMailpit(seed.request);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await enterWithProfile(page, seed.code.code, 'Eli'); // 没填 email
  await bookInChat(page, 15);

  const frame = bookedFrame(page);
  const prompt = frame.getByTestId('booking-email-prompt');
  await expect(prompt).toBeVisible({ timeout: 10_000 });
  await frame.getByTestId('booking-email-other').fill('eli.typed@example.com');
  await frame.getByTestId('booking-email-send').click();

  const mail = await waitForMailEnvelopeTo(seed.request, 'eli.typed@example.com');
  expect(mail.from).toBe(MAIL_FROM);
  await expect(prompt).toHaveAttribute('data-sent', 'true', { timeout: 5_000 });
  expect(await countMailpitMessages(seed.request)).toBe(1);
  await ctx.close();
}

// 非法 —— 填垃圾地址 → send_confirmation tool/后端 ParseAddress 失败 → 422 →
// 卡内 error、不进 sent、零发送。收件人硬控在 tool/后端(D-4),沙盒卡绕不过。
async function invalidRecipientFlow(browser: Browser, seed: CodedSeed): Promise<void> {
  await clearMailpit(seed.request);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await enterWithProfile(page, seed.code.code, 'Nads'); // 没 session email
  await bookInChat(page, 13);

  const frame = bookedFrame(page);
  const prompt = frame.getByTestId('booking-email-prompt');
  await expect(prompt).toBeVisible({ timeout: 10_000 });
  await frame.getByTestId('booking-email-other').fill('not-an-email');
  await frame.getByTestId('booking-email-send').click();

  // 后端 422 经 tool-result 回卡 → error 可见(确定性信号)、不进 sent、零发送。
  await expect(frame.getByTestId('booking-email-error')).toBeVisible({ timeout: 5_000 });
  await expect(prompt).toHaveAttribute('data-sent', 'false');
  expect(await countMailpitMessages(seed.request)).toBe(0);
  await ctx.close();
}

// skip —— 点 skip 纯本地锁卡、不调 tool、不发信。
async function skipFlow(browser: Browser, seed: CodedSeed): Promise<void> {
  await clearMailpit(seed.request);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await enterWithProfile(page, seed.code.code, 'Mara', 'mara@example.com');
  await bookInChat(page, 16);

  const frame = bookedFrame(page);
  const prompt = frame.getByTestId('booking-email-prompt');
  await expect(prompt).toBeVisible({ timeout: 10_000 });
  await frame.getByTestId('booking-email-skip').click();

  await expect(prompt).toHaveAttribute('data-sent', 'true', { timeout: 5_000 });
  expect(await countMailpitMessages(seed.request)).toBe(0);
  await ctx.close();
}

// bookedFrame —— booked 沙盒卡 iframe;确认 widget 在内,经 frameLocator 取。
function bookedFrame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="mcp-app-card-calendar_book"]');
}

// enterWithProfile —— ?code 入口 → 名字选择器填 name + 可选 email → 提交 → 等 session。
async function enterWithProfile(
  page: Page, code: string, name: string, email?: string,
): Promise<void> {
  await goto(page, `/?code=${code}`);
  const session = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200, { timeout: 15_000 },
  );
  await page.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('visitor-name-input').fill(name);
  if (email !== undefined) await page.getByTestId('visitor-email-input').fill(email);
  await page.getByTestId('visitor-name-submit').click();
  await session;
}

// bookInChat —— script 一次 calendar_book,触发 → 等 booked 沙盒卡 iframe 出现。
// hour 错开真实 GCal 时段避免互相冲突(同 #122)。
async function bookInChat(page: Page, hour: number): Promise<void> {
  await scriptMockToolCall(page.request, {
    name: 'calendar_book',
    args: { topic: TOPIC, duration_min: 30, preferred_times: [future(7, hour)] },
  });
  const input = page.getByTestId('chat-input-field');
  await input.fill('book me a 30-minute chat next week, please');
  await input.press('Enter');
  await expect(page.getByTestId('mcp-app-card-calendar_book')).toBeVisible({ timeout: 20_000 });
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
