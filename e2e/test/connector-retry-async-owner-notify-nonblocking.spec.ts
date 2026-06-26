// connector-retry-async-owner-notify-nonblocking.spec.ts —— §五 重试矩阵 R6
// owner-notify 邮件按 D-6 声明 **async**(10×~30–60s 后台预算),**不堵 booking**:
//   ① 即便 notify 在重试,booking 立即返回(book-card 即出,不被通知重试拖住),
//   ② notify 在后台重试,**绝不**因为通知失败而回滚/失败 booking。
// 跟 R4(确认信同步、卡内可见)正交:这条管 owner 侧异步通知的「不阻塞 + 后台重试 +
// 失败不连坐 booking」。
//
// Retry R6: owner-notify email runs async with the long retry budget — the
// booking returns immediately (not blocked by notify retries) and the notify is
// retried in the background without ever failing the booking.
//
// RED / TDD：依赖 owner-notify 走 async 后台重试且对 booking 非阻塞/不连坐落地后转绿。

import { test, expect } from '@/fixtures/test';
import type { Browser, FrameLocator, Page, Playwright } from '@playwright/test';

import {
  configureMailConnector, clearMailpit, waitForMailEnvelopeTo, MAIL_FROM,
  armSMTPFault, resetSMTPFault,
} from '@/fixtures/mail';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { login } from '@/fixtures/admin';
import { getMockEvents } from '@/fixtures/gcal';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

const TOPIC = 'Intro call about backend work';

function bookedFrame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="mcp-app-card-calendar_book"]');
}

test.describe('connector retry · owner-notify async, non-blocking, retried in background (R6)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
    });
    await configureMailConnector(seed.request, OWNER.email, OWNER.password);
    // configureMailConnector 重新 login 轮换 CSRF —— 刷新 seed.csrf,否则
    // 后面 issueCodeWithSkills 拿旧 token 会 403(同 booking-owner-notify)。
    seed.csrf = (await login(seed.request, OWNER.email, OWNER.password)).csrf;
  });
  test.afterAll(async () => { await resetSMTPFault(seed.request); await teardownSeed(seed); });

  test('notify-on role + transient send faults → booking returns immediately, notify retried in background, booking never fails',
    async ({ browser }) => {
      await clearMailpit(seed.request);
      const code = await issueCodeWithSkills(seed.request, seed.csrf, {
        granted_skills: ['calendar.book'], notify_owner_on_booking: true,
      });

      // arm the transient owner-notify faults BEFORE booking so the first
      // background attempts fail and the async retry has to recover.
      await armSMTPFault(seed.request, { mode: 'transient', times: 2 });

      const page = await enterAndBook(browser, code.code, 'Dana', 14);

      // ① non-blocking: book-card is visible = booker tool returned. The notify
      // retries run in the background; the booking is NOT held until they finish.
      await expect(bookedFrame(page).getByTestId('book-card-time')).toBeVisible();

      // booking really committed — the event exists regardless of notify outcome.
      const events = await getMockEvents(seed.request);
      expect(events.length, 'booking committed (event exists)').toBeGreaterThanOrEqual(1);

      // ② background retry eventually delivers the owner notification (long async
      // budget recovers the transient faults) — and the booking was never failed.
      const mail = await waitForMailEnvelopeTo(seed.request, OWNER.email, 60_000);
      expect(mail.from).toBe(MAIL_FROM);
      expect(mail.text).toContain(TOPIC);

      await page.context().close();
    });
});

// enterAndBook —— ?code 入口 → 填名字 → script calendar_book → 触发 → 等 BookCard。
async function enterAndBook(
  browser: Browser, code: string, name: string, hour: number,
): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await goto(page, `/?code=${code}`);
  const session = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200, { timeout: 15_000 },
  );
  await page.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('visitor-name-input').fill(name);
  await page.getByTestId('visitor-name-submit').click();
  await session;

  await scriptMockToolCall(page.request, {
    name: 'calendar_book',
    args: { topic: TOPIC, duration_min: 30, preferred_times: [future(7, hour)] },
  });
  const input = page.getByTestId('chat-input-field');
  await input.fill('book me a 30-minute chat next week, please');
  await input.press('Enter');
  await expect(page.getByTestId('mcp-app-card-calendar_book')).toBeVisible({ timeout: 20_000 });
  return page;
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
