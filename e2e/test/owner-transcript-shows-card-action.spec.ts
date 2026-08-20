// owner-transcript-shows-card-action.spec.ts —— F-B-9 的第三面：**owner 事后读逐字稿**。
//
// 「owner 读得到访客那段对话」是这个产品对 owner 的承诺。而访客在沙盒卡上做的事
// （点了 Cancel meeting）走的是另一条路，落库之后 role 是 `event` —— 不是谁说的话。
//
// 那一面上原来的映射是「不是 visitor 就当 assistant」，于是这样一行会被贴上 `AI` 的标签：
// owner 读到的是「**AI 说**它取消了这场会」，而 AI 从没说过这句
// （[[collapsed-error-class-kills-its-own-branch]]：上游归成一类，为它写的那一格永远出不来）。
//
// 这条守两件事，缺一不可：
//   1. 这条事件在 owner 的逐字稿上**看得见**（不能只在访客那一侧存在）；
//   2. 它**不是**以 AI 的身份出现的。

import { test, expect } from '@/fixtures/test';
import type { FrameLocator, Page } from '@playwright/test';

import {
  OWNER, seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { goto, gotoAdminSection } from '@/fixtures/navigate';

const VISITOR = 'Transcript Tess';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('F-B-9 · the owner reads what the visitor did on the card', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'], max_bookings: 3,
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('a card action is in the transcript, and it is not attributed to the AI',
    async ({ browser, adminPage }) => {
      test.setTimeout(180_000);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterChat(page, seed.code.code);

      const bookTag = await scriptMockToolCall(page.request, {
        name: 'calendar_book',
        args: { topic: 'Transcript check', duration_min: 30, preferred_times: [future(5, 16)] },
      });
      await ask(page, `book me a 30-minute chat, please${bookTag}`);
      await expect(page.getByTestId('mcp-app-card-calendar_book'))
        .toBeVisible({ timeout: 30_000 });

      const frame = bookedFrame(page);
      await frame.getByTestId('book-card-cancel').click();
      await expect(frame.getByTestId('tool-card-calendar_book'))
        .toHaveAttribute('data-cancelled', 'true', { timeout: 30_000 });
      await ctx.close();

      await gotoAdminSection(adminPage, 'conversations');
      await adminPage.getByText(VISITOR, { exact: true }).click();
      const modal = adminPage.getByTestId('transcript-body');
      await expect(modal).toBeVisible({ timeout: 10_000 });
      // 先证这段对话真的在这张模态上，否则下面的断言是在一张空模态上找东西
      // （[[two-guards-dying-at-one-line]]）。
      await expect(modal, 'the conversation itself is in the transcript')
        .toContainText('book me a 30-minute chat');

      const event = modal.getByTestId('conv-event-line');
      await expect(event, 'the owner can see what the visitor did on the card')
        .toBeVisible({ timeout: 10_000 });
      await expect(event, 'and which action it was').toContainText('calendar_cancel');

      // 归属：这一行不是 AI 说的。上面那条正断言已经成立，所以这句否定不是在空集上过关
      // （[[negated-assertion-passes-while-absent]]）。
      await expect(
        modal.locator('li').filter({ hasText: 'card action' }).locator('.mono')
          .filter({ hasText: /^ai$/ }),
        'no AI label sits on the card action — the AI never said it',
      ).toHaveCount(0);
    });
});

async function ask(page: Page, q: string): Promise<void> {
  const input = page.getByTestId('chat-input-field');
  await input.fill(q);
  await input.press('Enter');
}

function bookedFrame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="mcp-app-card-calendar_book"]');
}

async function enterChat(page: Page, code: string): Promise<void> {
  await goto(page, `/?code=${code}`);
  const session = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200, { timeout: 15_000 },
  );
  await page.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('visitor-name-input').fill(VISITOR);
  await page.getByTestId('visitor-email-input').fill('tess@example.com');
  await page.getByTestId('visitor-name-submit').click();
  await session;
  await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
