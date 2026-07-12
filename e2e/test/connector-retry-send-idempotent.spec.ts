// connector-retry-send-idempotent.spec.ts —— §五 重试矩阵 R4 · 确认信不双发
//
// `send_confirmation` 是 NON-IDEMPOTENT 写。盲重试会双发。按锁定设计(§五 写幂等):
// 只在「发送前连接失败」重 / 带幂等键,绝不盲重。所以**在一个瞬时错误下**确认信仍
// 应送达且**恰好一封**(countMailpitMessages === 1,无双发)。镜像
// connector-retry-insert-idempotent(events.insert 不双订)。
//
// R4 重试下不双发: mock SMTP 注入一次瞬时错误;重试后恰好一封到达
// (waitForMailTo 收到 + countMailpitMessages === 1)。
//
// RED / TDD：直到 send_confirmation 的重试以「发送前连接失败」/幂等键为门,盲重试会发两封 → count 2 → 断言失败。落地后转绿。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, FrameLocator, Page, Playwright } from '@playwright/test';

import {
  configureMailConnector, clearMailpit, waitForMailTo, countMailpitMessages,
} from '@/fixtures/mail';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

const MOCK = process.env['MOCK_BASE_URL'] ?? 'http://localhost:9000';
const TOPIC = 'Intro call about backend work';
const RECIPIENT = 'dana.r4@example.com';

// flakeSMTPSendOnce —— fail the SMTP send ONCE then succeed. The mock is honest about
// whether the message landed, so a blind retry double-send shows up as count === 2.
// mode='transient-after-deliver' is the dangerous case: server accepted the message but
// the client saw an error → a blind retry double-sends. Control endpoint:
// POST /__mock/smtp/fail (mock-stack/mail/main.go).
async function flakeSMTPSendOnce(
  request: APIRequestContext, mode = 'transient-after-deliver',
): Promise<void> {
  await request.post(`${MOCK}/__mock/smtp/fail`, { data: { mode, times: 1 } });
}

test.describe('connector retry · confirmation send under transient error does not double-send (R4)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('transient error around send_confirmation is retried → EXACTLY ONE mail arrives',
    async ({ browser }) => {
      await clearMailpit(seed.request);
      await flakeSMTPSendOnce(seed.request, 'transient-after-deliver');

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterWithProfile(page, seed.code.code, 'Dana', RECIPIENT);
      await bookInChat(page, 14);

      const frame = bookedFrame(page);
      await expect(frame.getByTestId('booking-email-prompt')).toBeVisible({ timeout: 10_000 });
      await frame.getByTestId('booking-email-use-profile').click();

      // the mail must arrive (retry recovers the transient fault)...
      await waitForMailTo(seed.request, RECIPIENT);
      // ...and the load-bearing assertion: exactly ONE, never two.
      expect(
        await countMailpitMessages(seed.request),
        'idempotent send — no double-send under retry',
      ).toBe(1);

      await ctx.close();
    });
});

function bookedFrame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="mcp-app-card-calendar_book"]');
}

async function enterWithProfile(
  page: Page, code: string, name: string, email: string,
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
}

async function bookInChat(page: Page, hour: number): Promise<void> {
  const tag = await scriptMockToolCall(page.request, {
    name: 'calendar_book',
    args: { topic: TOPIC, duration_min: 30, preferred_times: [future(7, hour)] },
  });
  const input = page.getByTestId('chat-input-field');
  await input.fill(`book me a 30-minute chat next week, please${tag}`);
  await input.press('Enter');
  await expect(page.getByTestId('mcp-app-card-calendar_book')).toBeVisible({ timeout: 20_000 });
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
