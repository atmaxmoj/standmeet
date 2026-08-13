// claim-needs-a-receipt.spec.ts —— F-A-37。一轮答案说它替访客办成了一件事，这一轮就必须有
// 那件事的回执；没有 → 产品在旁边把话说清楚，而不是让那句承诺原样立在那儿。
//
// 真实环境里的样子：连约四场之后，第五次的回答是 *"Booked. ✅ Monday, August 31 · 13:00–13:30
// UTC … Invite went to … That's all three on the calendar"*，而那一轮后端日志里**一个
// `agent tool start` 都没有**，真日历整天空的，聊天里也没有回执卡。访客带着一个不存在的会议
// 离开。浏览器回放的历史只有 `{role, content}`，模型读回去的是四条自己写过的 "Booked" ——
// 要补全的成了那句话，不是那个动作。
//
// **为什么这条能确定性地跑**：闸门是宿主判的（能力在 manifest 里声明「哪些说法算主张、哪个
// 工具算回执」，内核只问这一轮满不满足），所以这里不需要真模型碰运气 —— 脚本让模型只说话、
// 不调工具，闸门必须响。真模型那一侧另有 `make eval-booking-fabrication` 反复探。
//
// 判据在访客看得见的地方：那句产品自己的话。

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

// FABRICATED —— 一句只说话、不做事的回答，用的就是真实环境里那句的形状。
const FABRICATED = 'Booked. ✅ Monday, August 31 · 13:00–13:30 UTC — topic: "progress state '
  + 'check." Invite went to visitor@example.com.';

test.describe('F-A-37 · a claim without a receipt does not stand', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('the model says it booked, calls nothing → the visitor is told nothing was done',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterChat(page, seed.code.code, 'Wren');

      const tag = await scriptMockReplyText(page.request, FABRICATED);
      const input = page.getByTestId('chat-input-field');
      await input.fill(`book me something next week${tag}`);
      await input.press('Enter');

      // 那句谎话会照常流出来（已经出去的字收不回来）——要断的是它旁边那句产品的话。
      await expect(page.getByTestId('answer-partial-notice'),
        'the product says the action did not happen')
        .toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('answer-partial-notice'))
        .toContainText(/nothing was actually done/i);
      await ctx.close();
    });

  test('the same claim WITH the tool called stands untouched',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterChat(page, seed.code.code, 'Wynn');

      // 走真工具的那条路：卡片渲出来 = 回执在，闸门必须放行。
      const { scriptMockToolCall } = await import('@/fixtures/mock-llm-script');
      const tag = await scriptMockToolCall(page.request, {
        name: 'calendar_book',
        args: { topic: 'Intro call', duration_min: 30, preferred_times: [future(7, 14)] },
      });
      const input = page.getByTestId('chat-input-field');
      await input.fill(`book me a 30-minute chat${tag}`);
      await input.press('Enter');

      await expect(page.getByTestId('mcp-app-card-calendar_book'),
        'the booking really happened').toBeVisible({ timeout: 20_000 });
      // 闸门是必要条件，不是审查：有回执的主张不该被加注。
      await expect(page.getByTestId('answer-partial-notice'),
        'a backed claim carries no correction').toHaveCount(0);
      await ctx.close();
    });

  // 闸门错杀一句正确的**拒绝**，比它挡下的谎话更贵：访客被告知「什么都没发生」，而产品其实
  // 正确地告诉过他那个时间不能约。拒绝里天然带着 "booked" 这个词（"already booked"），所以
  // 这一条盯的是短语表有没有宽到把它收进去。
  test('a refusal that says the slot is already booked is not a claim',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterChat(page, seed.code.code, 'Wade');

      const tag = await scriptMockReplyText(page.request,
        "That time is already booked — the slot you asked for is booked solid. "
        + 'Want me to look at the next morning instead?');
      const input = page.getByTestId('chat-input-field');
      await input.fill(`can you take 9am next Tuesday${tag}`);
      await input.press('Enter');

      await expect(page.getByTestId('answer-body').last(),
        'the refusal rendered').toContainText(/already booked/i, { timeout: 20_000 });
      await expect(page.getByTestId('answer-partial-notice'),
        'a refusal is not a claim — no correction belongs on it').toHaveCount(0);
      await ctx.close();
    });
});

async function enterChat(page: Page, code: string, name: string): Promise<void> {
  await goto(page, `/?code=${code}`);
  const session = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200, { timeout: 15_000 },
  );
  await page.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('visitor-name-input').fill(name);
  await page.getByTestId('visitor-name-submit').click();
  await session;
  await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
}

async function prep(playwright: Playwright): Promise<CodedSeed> {
  return seedCodeVisitorOnConnectedOwner(playwright, {
    granted_skills: ['calendar.book'], max_bookings: 3,
  });
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
