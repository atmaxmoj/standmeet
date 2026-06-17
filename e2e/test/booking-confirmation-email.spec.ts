// booking-confirmation-email.spec.ts —— #122: 约好之后,访客在 BookCard 上选择
// 把确认/邀请邮件发到哪。**真 e2e:浏览器 → 前端卡片 → 后端 → owner SMTP(Mailpit)**。
// 发不发 / 发给谁全是访客点卡片 + 后端确定性执行,AI 不参与。
//
// 卡片(BookCard 内的确认 widget)契约:
//   [data-testid=booking-email-prompt]       —— 容器(约成后出现)
//   [data-testid=booking-email-use-profile]  —— 「引用」按钮(发到 session email),
//                                                仅当 session 有 email 时渲染
//   [data-testid=booking-email-other]        —— 「透传」文本框(填别的地址)
//   [data-testid=booking-email-send]         —— 发「透传」那个地址
//   [data-testid=booking-email-skip]         —— 「不发」
//
// 收件人只能是 引用(已知 session email)或 透传(访客字面输入)—— 跟 #121 收件人硬控一致。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

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

  test('引用: visitor with a profile email clicks "send to my email" → owner mails it',
    async ({ browser }) => {
      await clearMailpit(seed.request);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterWithProfile(page, seed.code.code, 'Dana', 'dana.profile@example.com');
      await bookInChat(page, 14);

      const prompt = page.getByTestId('booking-email-prompt');
      await expect(prompt).toBeVisible({ timeout: 10_000 });
      await prompt.getByTestId('booking-email-use-profile').click();

      const mail = await waitForMailEnvelopeTo(seed.request, 'dana.profile@example.com');
      expect(mail.from).toBe(MAIL_FROM);
      expect(mail.text).toContain(TOPIC);
      // 邮件内容:HTML 正文带 schema.org JSON-LD(EventReservation)→ Gmail 富卡片。
      expect(mail.html).toContain(TOPIC);
      expect(mail.html).toContain('application/ld+json');
      expect(mail.html).toContain('"@type":"EventReservation"');
      expect(mail.html).toContain('"reservationFor"');
      expect(mail.html).toContain('"startDate"');

      // 一笔 booking 只发一次:点完即锁(进 sent 态、动作按钮消失),Mailpit 只一封。
      await expect(prompt).toHaveAttribute('data-sent', 'true', { timeout: 5_000 });
      await expect(prompt.getByTestId('booking-email-use-profile')).toHaveCount(0);
      await expect(prompt.getByTestId('booking-email-skip')).toHaveCount(0);
      await new Promise((r) => setTimeout(r, 500));
      expect(await countMailpitMessages(seed.request)).toBe(1);
      await ctx.close();
    });

  test('透传: no profile email → only "other" + "don\'t send"; type an address → owner mails it',
    async ({ browser }) => {
      await clearMailpit(seed.request);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterWithProfile(page, seed.code.code, 'Eli'); // 没填 email
      await bookInChat(page, 15);

      const prompt = page.getByTestId('booking-email-prompt');
      await expect(prompt).toBeVisible({ timeout: 10_000 });
      // 没 session email → 不渲染「引用」
      await expect(prompt.getByTestId('booking-email-use-profile')).toHaveCount(0);
      await prompt.getByTestId('booking-email-other').fill('eli.typed@example.com');
      await prompt.getByTestId('booking-email-send').click();

      const mail = await waitForMailEnvelopeTo(seed.request, 'eli.typed@example.com');
      expect(mail.from).toBe(MAIL_FROM);
      await ctx.close();
    });

  test('不发: visitor clicks "don\'t send" → no email goes out',
    async ({ browser }) => {
      await clearMailpit(seed.request);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterWithProfile(page, seed.code.code, 'Mara', 'mara@example.com');
      await bookInChat(page, 16);

      const prompt = page.getByTestId('booking-email-prompt');
      await expect(prompt).toBeVisible({ timeout: 10_000 });
      await prompt.getByTestId('booking-email-skip').click();

      await new Promise((r) => setTimeout(r, 1_000));
      expect(await countMailpitMessages(seed.request)).toBe(0);
      await ctx.close();
    });
});

// owner 没配 mail connector → 整张确认卡不渲染(owner 根本发不了信)。
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

      // BookCard 照常显示已约,但没有确认邮件那一截。
      await expect(page.getByTestId('book-card-time')).toBeVisible();
      await expect(page.getByTestId('booking-email-prompt')).toHaveCount(0);
      await ctx.close();
    });
});

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

// bookInChat —— script 一次 calendar_book,发一句话触发 → 等 BookCard 出现。
// hour 让每条 test 落在**不同的真实 GCal 时段**:同一 owner 日历下若都约同一时刻,
// 后约的会真撞前约的(slot 已 busy)→ 不出确认卡。固定 +7 天(已知工作日)、只错开
// 小时(都在 working hours 内、互不重叠 30 分钟),既避冲突又不踩周末/policy。
async function bookInChat(page: Page, hour: number): Promise<void> {
  await scriptMockToolCall(page.request, {
    name: 'calendar_book',
    args: { topic: TOPIC, duration_min: 30, preferred_times: [future(7, hour)] },
  });
  const input = page.getByTestId('chat-input-field');
  await input.fill('book me a 30-minute chat next week, please');
  await input.press('Enter');
  await expect(page.getByTestId('tool-card-calendar_book')).toBeVisible({ timeout: 20_000 });
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
