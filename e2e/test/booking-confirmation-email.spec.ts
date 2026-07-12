// booking-confirmation-email.spec.ts —— #122: 约好之后,访客在 booked 卡上选择
// 把确认/邀请邮件发到哪。**真 e2e:浏览器 → 沙盒 iframe 卡 → mcp-ui:tool →
// send_confirmation tool → 后端 → owner SMTP(Mailpit)**。
//
// 重构后(connector deps,§二 + D-4):确认 widget 不再是 React 卡 + REST,而是落在
// `mcp-app-card-calendar_book` 沙盒 iframe 内;点「引用/透传/skip」后卡 post
// `mcp-ui:tool` → host 带 session context 派发 `send_confirmation` tool。**收件人硬控
// (引用 session-email / 透传 typed address / 非法 → 422 / skip)放 tool 内(后端校验,
// 422 仍后端出)** —— 沙盒卡只收集 + 显示,绕不过后端那道门(#121)。
//
// 卡片(iframe 内的确认 widget)契约:
//   [data-testid=booking-email-prompt]       —— 容器(约成后出现)
//   [data-testid=booking-email-use-profile]  —— 「引用」按钮(发到 session email),
//                                                仅当 session 有 email 时渲染
//   [data-testid=booking-email-other]        —— 「透传」文本框(填别的地址)
//   [data-testid=booking-email-send]         —— 发「透传」那个地址
//   [data-testid=booking-email-skip]         —— 「不发」
//   [data-testid=booking-email-error]        —— 后端 422 时卡内显示的友好错误
//
// 收件人只能是 引用(已知 session email)或 透传(访客字面输入)—— 校验落 send_confirmation
// tool/后端,跟 #121 收件人硬控一致。

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

test.describe('booking · send-confirmation email (#122 — deterministic, no AI)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'], max_bookings: 9,
    });
    await configureMailConnector(seed.request, OWNER.email, OWNER.password);
    await clearMailpit(seed.request);
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('引用: profile email → "send to my email" → send_confirmation tool mails it (HTML + schema.org)',
    ({ browser }) => quoteFlow(browser, seed));
  test('透传: no profile email → type an address → send_confirmation tool mails it',
    ({ browser }) => passthroughFlow(browser, seed));
  test('透传 非法地址: junk → backend 422, card error, nothing sent',
    ({ browser }) => invalidRecipientFlow(browser, seed));
  test('不发: "don\'t send" → no email goes out',
    ({ browser }) => skipFlow(browser, seed));
});

// 引用 —— session email 在 → 点引用 → send_confirmation tool 发到它;邮件带 schema.org
// markup;一笔一发。点击落在 iframe 内 → post mcp-ui:tool。
async function quoteFlow(browser: Browser, seed: CodedSeed): Promise<void> {
  await clearMailpit(seed.request);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await enterWithProfile(page, seed.code.code, 'Dana', 'dana.profile@example.com');
  await bookInChat(page, 14);

  const frame = bookedFrame(page);
  const prompt = frame.getByTestId('booking-email-prompt');
  await expect(prompt).toBeVisible({ timeout: 10_000 });
  await frame.getByTestId('booking-email-use-profile').click();

  // 可观察副作用 = send_confirmation tool 经 connector proxy 真发了一封到 session email。
  const mail = await waitForMailEnvelopeTo(seed.request, 'dana.profile@example.com');
  expect(mail.from).toBe(MAIL_FROM);
  expect(mail.text).toContain(TOPIC);
  expect(mail.html).toContain(TOPIC);
  expect(mail.html).toContain('application/ld+json');
  expect(mail.html).toContain('"@type":"EventReservation"');
  expect(mail.html).toContain('"reservationFor"');
  expect(mail.html).toContain('"startDate"');
  // Gmail EventReservation 必填:reservationNumber + location(线上 → VirtualLocation)。
  expect(mail.html).toContain('"reservationNumber"');
  expect(mail.html).toContain('"@type":"VirtualLocation"');
  // 可见卡片里那条可点链接(访客唯一能点的东西)在、且指向真实 GCal 事件。
  expect(mail.html).toContain('open in google calendar');
  expect(mail.html).toContain('calendar.google.com');

  // tool-result 回卡即锁(sent 态、动作消失);邮件已 waitForMailEnvelope 收到 → count 已确定为 1。
  await expect(prompt).toHaveAttribute('data-sent', 'true', { timeout: 5_000 });
  await expect(frame.getByTestId('booking-email-use-profile')).toHaveCount(0);
  await expect(frame.getByTestId('booking-email-skip')).toHaveCount(0);
  expect(await countMailpitMessages(seed.request)).toBe(1);
  await ctx.close();
}

// 透传 —— 没 session email → 不渲引用 → 现填地址,send_confirmation tool 发出。
async function passthroughFlow(browser: Browser, seed: CodedSeed): Promise<void> {
  await clearMailpit(seed.request);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await enterWithProfile(page, seed.code.code, 'Eli'); // 没填 email
  await bookInChat(page, 15);

  const frame = bookedFrame(page);
  const prompt = frame.getByTestId('booking-email-prompt');
  await expect(prompt).toBeVisible({ timeout: 10_000 });
  await expect(frame.getByTestId('booking-email-use-profile')).toHaveCount(0);
  await frame.getByTestId('booking-email-other').fill('eli.typed@example.com');
  await frame.getByTestId('booking-email-send').click();

  const mail = await waitForMailEnvelopeTo(seed.request, 'eli.typed@example.com');
  expect(mail.from).toBe(MAIL_FROM);
  await ctx.close();
}

// 透传非法 —— 填垃圾地址 → send_confirmation tool/后端 ParseAddress 失败 → 422 →
// 卡内报错(tool-result 带 error)、不进 sent、零发送。收件人硬控在 tool/后端(D-4),
// 沙盒卡绕不过。
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

  // 报错可见 = 后端 422 经 tool-result 回卡 → 没进 sent、一封都没发。error 可见就是
  // 确定性信号,无需 sleep。
  await expect(frame.getByTestId('booking-email-error')).toBeVisible({ timeout: 5_000 });
  await expect(prompt).toHaveAttribute('data-sent', 'false');
  expect(await countMailpitMessages(seed.request)).toBe(0);
  await ctx.close();
}

// 不发 —— 点 skip 纯本地锁卡、不发 tool / 不发信。data-sent=true = 已落定,此刻零邮件。
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

// owner 没配 mail connector → 整张确认 widget 不渲染(owner 根本发不了信)。
// 重构后这条由 connector 依赖门兜底:send_confirmation 的 booker 能力 Requires smtp,
// 未连时确认 widget 不进卡 —— booked 卡照常显示已约,但 iframe 内没有 email-prompt。
test.describe('booking · no mail connector → no confirmation card (#122)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    // 注意:不调 configureMailConnector —— owner 没有发信能力。
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('booked, but owner can\'t email → booking-email-prompt is not rendered',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterWithProfile(page, seed.code.code, 'Dana', 'dana.profile@example.com');
      await bookInChat(page, 17);

      // booked 卡照常显示已约,但 iframe 内没有确认邮件那一截。
      const frame = bookedFrame(page);
      await expect(frame.getByTestId('book-card-time')).toBeVisible();
      await expect(frame.getByTestId('booking-email-prompt')).toHaveCount(0);
      await ctx.close();
    });
});

// bookedFrame —— 已外置的 booked 卡是个沙盒 iframe;内容(time + 确认 widget)经 frameLocator 取。
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

// bookInChat —— script 一次 calendar_book,发一句话触发 → 等 booked 沙盒卡 iframe 出现。
// hour 让每条 test 落在**不同的真实 GCal 时段**:同一 owner 日历下若都约同一时刻,
// 后约的会真撞前约的(slot 已 busy)→ 不出确认卡。固定 +7 天(已知工作日)、只错开
// 小时(都在 working hours 内、互不重叠 30 分钟),既避冲突又不踩周末/policy。
async function bookInChat(page: Page, hour: number): Promise<void> {
  const tag = await scriptMockToolCall(page.request, {
    name: 'calendar_book',
    args: { topic: TOPIC, duration_min: 30, preferred_times: [future(7, hour)] },
  });
  const input = page.getByTestId('chat-input-field');
  await input.fill(`book me a 30-minute chat next week, please${tag}`);
  await input.press('Enter');
  // booked 卡现在是沙盒 iframe(mcp-app-card-calendar_book),不是主 DOM 里的 React 卡。
  await expect(page.getByTestId('mcp-app-card-calendar_book')).toBeVisible({ timeout: 20_000 });
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
