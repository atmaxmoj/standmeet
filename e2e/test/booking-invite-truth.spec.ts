// booking-invite-truth.spec.ts —— F-B-6。预约回执必须**说出邀请发给了谁**，包括「谁都没有」。
//
// 真实环境里发生的事：访客在身份弹窗把「email (optional, for meeting invites)」留空，照样
// 约成了；聊天于是说 *"The calendar invite will go to sijie.wang.lark@gmail.com. See you then."*
// —— 那个地址是访客在**对话正文里**打的字。真收件箱空的，Google 上那个事件一个参会人都没有。
//
// 机制不是「模型瞎编」，是它手上根本没有可以反驳自己的那一格：
//   · `book.go:53` 的 `VisitorEmail` 带 `omitempty` —— 没收集到邮箱时这个字段整个消失，
//     回执变成 `{ok, event_id, html_link, start, end, can_email:true}`；
//   · `can_email` 是 `ownerCanEmail(ownerID)`，说的是**能不能**发信，不是**发没发**；
//   · 而 `content.go:19` 的 system-prompt fragment 又告诉模型「the calendar invite goes to the
//     email the visitor entered when they arrived (if they gave one)」。
// 「有没有给」这一格空着，模型就从对话里补 —— 一个省略的字段不等于 null（[[empty-is-not-json-null]]）。
//
// 判据放在**访客真看得见的那张卡**上，不放在 wire 上：卡才是访客留下的凭证（正文会被滚走），
// 而这条缺陷的伤害恰恰是「凭证上写着一件没发生的事」。

import { test, expect } from '@/fixtures/test';
import type { FrameLocator, Page, Playwright } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

const GUEST_EMAIL = 'wanda.guest@example.com';

test.describe('F-B-6 · the booking receipt says who was invited', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('visitor gave no email → the card says plainly that no invite went out',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterChat(page, seed.code.code, 'Wanda', '');
      await bookOnce(page, 7);

      const line = bookedFrame(page).getByTestId('book-card-invite');
      // 断的是「它说了没有人被邀请」，不是「它没说错话」—— 沉默正是这条缺陷本身。
      await expect(line, 'the receipt states that nobody was invited')
        .toBeVisible({ timeout: 20_000 });
      await expect(line).toContainText(/no invite|not emailed|nobody/i);
      await ctx.close();
    });

  test('visitor gave an email → the card names that address',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterChat(page, seed.code.code, 'Wendy', GUEST_EMAIL);
      await bookOnce(page, 8);

      await expect(bookedFrame(page).getByTestId('book-card-invite'),
        'the receipt names the address the invite went to')
        .toContainText(GUEST_EMAIL, { timeout: 20_000 });
      await ctx.close();
    });
});

// bookOnce —— 派一次 scripted calendar_book（+days 天的工作时间内），等卡出现。
async function bookOnce(page: Page, days: number): Promise<void> {
  const tag = await scriptMockToolCall(page.request, {
    name: 'calendar_book',
    args: { topic: 'Intro call', duration_min: 30, preferred_times: [future(days, 14)] },
  });
  const input = page.getByTestId('chat-input-field');
  await input.fill(`book me a 30-minute chat${tag}`);
  await input.press('Enter');
  await expect(page.getByTestId('mcp-app-card-calendar_book'),
    'booked card iframe visible').toBeVisible({ timeout: 20_000 });
}

function bookedFrame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="mcp-app-card-calendar_book"]');
}

// enterChat —— ?code 入口 → 身份弹窗填名字（email 给空串就跳过那个可选框）→ 等 session。
async function enterChat(
  page: Page, code: string, name: string, email: string,
): Promise<void> {
  await goto(page, `/?code=${code}`);
  const session = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200, { timeout: 15_000 },
  );
  await page.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('visitor-name-input').fill(name);
  if (email !== '') await page.getByTestId('visitor-email-input').fill(email);
  await page.getByTestId('visitor-name-submit').click();
  await session;
  await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
}

async function prep(playwright: Playwright): Promise<CodedSeed> {
  return seedCodeVisitorOnConnectedOwner(playwright, {
    granted_skills: ['calendar.book'],
    max_bookings: 3,
  });
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
