// connector-err-confirmation-idempotent.spec.ts —— §四 E14
// 确认信重复发不双发：访客在 BookCard 上点两次「发确认」→ 收件箱里仍只有 1 封
// （send_confirmation 幂等 / 点完即锁，绝不双发）。Model on booking-confirmation-email。
//
// RED / TDD：依赖 send_confirmation 防重（点完锁卡 + 后端幂等）落地后转绿。
//
// Error stream E14 (idempotency): sending the confirmation email twice does not
// double-send — Mailpit count stays at 1.

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import {
  configureMailConnector, clearMailpit, waitForMailEnvelopeTo, countMailpitMessages,
} from '@/fixtures/mail';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

const TOPIC = 'Intro call about backend work';

test.describe('connector error stream · confirmation email is idempotent (E14)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('clicking "send confirmation" twice → exactly one email goes out',
    async ({ browser }) => {
      await clearMailpit(seed.request);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterWithProfile(page, seed.code.code, 'Dana', 'dana.profile@example.com');
      await bookInChat(page, 14);

      const prompt = page.getByTestId('booking-email-prompt');
      await expect(prompt).toBeVisible({ timeout: 10_000 });

      // first send.
      await prompt.getByTestId('booking-email-use-profile').click();
      await waitForMailEnvelopeTo(seed.request, 'dana.profile@example.com');
      // card locks after a successful send (sent=true) → the action is gone, can't
      // double-click. Idempotency is enforced at the UI; the backend de-dupes too.
      await expect(prompt).toHaveAttribute('data-sent', 'true', { timeout: 5_000 });

      // attempt a second send via the same tool call (bypassing the locked UI),
      // simulating a retry / double-fire — must NOT produce a second email.
      await scriptMockToolCall(page.request, {
        name: 'send_confirmation',
        args: { to: 'dana.profile@example.com' },
        key: 'e14-resend',
      });
      const input = page.getByTestId('chat-input-field');
      await input.fill('please resend that confirmation');
      await input.press('Enter');

      // give the (idempotent) resend a chance to land; count must stay at 1.
      await page.waitForTimeout(2_000);
      expect(await countMailpitMessages(seed.request), 'no double-send').toBe(1);

      await ctx.close();
    });
});

// enterWithProfile —— ?code 入口 → 名字选择器填 name + email → 提交 → 等 session。
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

// bookInChat —— script 一次 calendar_book，触发 → 等 BookCard 出现。
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

async function prep(playwright: Playwright): Promise<CodedSeed> {
  const seed = await seedCodeVisitorOnConnectedOwner(playwright, {
    granted_skills: ['calendar.book'], max_bookings: 9,
  });
  await configureMailConnector(seed.request, OWNER.email, OWNER.password);
  return seed;
}
